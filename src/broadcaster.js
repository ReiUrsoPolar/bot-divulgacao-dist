// src/broadcaster.js
import {
  registarHistorico, getCfg, setGrupoActivo,
  incrementarFalhasGrupo, resetarFalhasGrupo, FALHAS_MAX,
} from './database.js'
import { logStatus } from './logger.js'

// ── Parâmetros anti-ban ────────────────────────────────────────────────────
const DELAY_MIN        = 10_000   // 10s mínimo entre grupos dentro de um batch
const DELAY_MAX        = 18_000   // 18s máximo entre grupos dentro de um batch
const BATCH_SIZE       = 15       // grupos por batch antes de pausa longa
const PAUSA_MIN        = 120_000  // 2 min mínimo entre batches
const PAUSA_MAX        = 240_000  // 4 min máximo entre batches
const GAP_CLIENTES_MIN = 3_000    // 3s entre clientes no mesmo grupo
const GAP_CLIENTES_MAX = 6_000    // 6s entre clientes no mesmo grupo
const PAUSA_RETRY      = 3 * 60_000  // 3 min antes de retentar grupos forbidden

// Caracteres invisíveis unicode — tornam cada mensagem única sem alterar o visual
const INVISIBLES = ['​', '‌', '‍', '⁠', '﻿']

function _rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function _delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// Insere caractere invisível aleatório — cada mensagem é única
function _variarTexto(texto) {
  if (typeof texto !== 'string' || texto.length < 2) return texto
  const char = INVISIBLES[_rand(0, INVISIBLES.length - 1)]
  const pos  = _rand(1, texto.length - 1)
  return texto.slice(0, pos) + char + texto.slice(pos)
}

// Baralha array in-place (Fisher-Yates)
function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = _rand(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Ordena grupos por saúde: menos falhas primeiro, mais recente sucesso primeiro
function _ordenarPorSaude(grupos) {
  return [...grupos].sort((a, b) => {
    if (a.falhas_consecutivas !== b.falhas_consecutivas)
      return a.falhas_consecutivas - b.falhas_consecutivas
    return (b.last_ok_at ?? 0) - (a.last_ok_at ?? 0)
  })
}

// Retorna: 'ok' | 'not-member' | 'forbidden' | 'error'
//
//  'not-member'  → bot não está no grupo (removido/saiu)  → desactivar imediatamente
//  'forbidden'   → grupo restringe envios a admins        → sistema de 5 falhas (pode ser temporário)
//  'error'       → problema de rede ou outro transitório  → não penalizar o grupo
async function _enviarParaGrupo(sock, jid, payload) {
  try {
    await sock.sendPresenceUpdate('composing', jid).catch(() => {})
    await _delay(_rand(800, 2_000))
    await sock.sendMessage(jid, payload)
    await sock.sendPresenceUpdate('paused', jid).catch(() => {})
    return 'ok'
  } catch (e) {
    const msg = (e?.message ?? '').toLowerCase()
    // Bot foi removido / nunca entrou → não vale a pena tentar de novo
    if (msg.includes('not a participant') || msg.includes('not-participant')) {
      return 'not-member'
    }
    // Grupo com envio restrito a admins → pode ser temporário (ex: grupos que fecham à noite)
    if (msg.includes('forbidden') || msg.includes('not-authorized')) {
      return 'forbidden'
    }
    logStatus(`Erro ao enviar para ${jid}: ${e?.message}`, 'red')
    return 'error'
  }
}

export function construirPayload(media_type, conteudo, caption = '') {
  switch (media_type) {
    case 'text':
      return { text: conteudo.toString() }
    case 'image':
      return { image: Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo), caption }
    case 'video':
      return { video: Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo), caption }
    case 'audio':
      return { audio: Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo), mimetype: 'audio/mp4' }
    case 'document':
      return { document: Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo), mimetype: 'application/octet-stream', caption }
    case 'sticker':
      return { sticker: Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo) }
    default:
      return { text: conteudo.toString() }
  }
}

// ── Broadcast multi-cliente intercalado ───────────────────────────────────
// Para cada grupo, envia a mensagem de TODOS os clientes com um pequeno gap.
// Resultado: todos os clientes atingem os mesmos grupos no mesmo broadcast,
// sem necessidade de broadcasts separados ou pausa de 12 min entre eles.
//
// tarefas = [{ media_type, conteudo, caption, agId }, ...]
// grupos  = [{ id, nome, falhas_consecutivas, last_ok_at, last_fail_at }, ...]
// Retorna: [{ agId, enviados, erros }, ...]
export async function broadcastMulti(sock, tarefas, grupos) {
  if (!tarefas.length || !grupos.length) {
    logStatus('BroadcastMulti: sem tarefas ou grupos.', 'yellow')
    return tarefas.map(t => ({ agId: t.agId, enviados: 0, erros: 0 }))
  }

  const maxPorEnvio = parseInt(getCfg('max_por_envio') ?? '60', 10)

  // 1. Ordenar por saúde: saudáveis (0 falhas) baralhos entre si,
  //    problemáticos no fim por ordem de falhas ascendente
  const ordenados     = _ordenarPorSaude(grupos)
  const saudaveis     = _shuffle(ordenados.filter(g => g.falhas_consecutivas === 0))
  const problematicos = ordenados.filter(g => g.falhas_consecutivas > 0)
  const gruposFinais  = [...saudaveis, ...problematicos].slice(0, maxPorEnvio)

  if (grupos.length > maxPorEnvio) {
    logStatus(
      `⚠️  Anti-ban: limitado a ${maxPorEnvio} de ${grupos.length} grupos por envio.` +
      ` Usa !maxenvio para ajustar.`,
      'yellow',
    )
  }

  // 2. Pré-construir payloads base por tarefa
  const payloads = tarefas.map(t => construirPayload(t.media_type, t.conteudo, t.caption))

  // 3. Contadores por tarefa
  const stats = tarefas.map(t => ({ agId: t.agId, enviados: 0, erros: 0 }))

  // 4. Grupos que retornaram forbidden → retry no fim
  //    Map: grupoId → Set de índices de tarefa que falharam
  const paraRetentar = new Map()

  // 5. Evitar dupla actualização de health por grupo
  const healthTracked = new Set()

  logStatus(
    `📢 BroadcastMulti: ${gruposFinais.length} grupos × ${tarefas.length} cliente(s) — início`,
    'cyan',
  )

  for (let i = 0; i < gruposFinais.length; i++) {
    const grupo   = gruposFinais[i]
    let grupoOk   = false

    for (let ti = 0; ti < tarefas.length; ti++) {
      // Variar texto para cada envio individual
      const payloadFinal = { ...payloads[ti] }
      if (payloadFinal.text)    payloadFinal.text    = _variarTexto(payloadFinal.text)
      if (payloadFinal.caption) payloadFinal.caption = _variarTexto(payloadFinal.caption)

      const resultado = await _enviarParaGrupo(sock, grupo.id, payloadFinal)

      if (resultado === 'ok') {
        stats[ti].enviados++
        grupoOk = true
      } else if (resultado === 'not-member') {
        // Bot não está no grupo → remover imediatamente (sem retry, sem 5 falhas)
        stats[ti].erros++
        if (!healthTracked.has(grupo.id)) {
          healthTracked.add(grupo.id)
          setGrupoActivo(grupo.id, false)
          logStatus(`🚫 Grupo removido (bot não é membro): ${grupo.nome || grupo.id}`, 'yellow')
        }
        // Sair do loop de tarefas para este grupo — inútil continuar
        break
      } else if (resultado === 'forbidden') {
        // Restrição de admins — pode ser temporária (grupo fecha à noite)
        stats[ti].erros++
        if (!paraRetentar.has(grupo.id)) paraRetentar.set(grupo.id, new Set())
        paraRetentar.get(grupo.id).add(ti)
      } else {
        // 'error' — problema de rede ou outro; não invalida o grupo
        stats[ti].erros++
      }

      // Pequena pausa entre clientes no mesmo grupo
      if (ti < tarefas.length - 1) {
        await _delay(_rand(GAP_CLIENTES_MIN, GAP_CLIENTES_MAX))
      }
    }

    // Actualizar health apenas uma vez por grupo
    if (!healthTracked.has(grupo.id)) {
      healthTracked.add(grupo.id)
      if (grupoOk) resetarFalhasGrupo(grupo.id)
      // Se grupoOk=false mas não foi forbidden, pode ser erro de rede; não penalizar agora
    }

    // Log de progresso a cada 10 grupos
    if ((i + 1) % 10 === 0 || i === gruposFinais.length - 1) {
      const tot  = stats.reduce((s, t) => s + t.enviados, 0)
      const errs = stats.reduce((s, t) => s + t.erros, 0)
      logStatus(
        `📊 ${i + 1}/${gruposFinais.length} grupos | ✅ ${tot} enviados · ❌ ${errs} erros`,
        'cyan',
      )
    }

    const ehUltimo = i === gruposFinais.length - 1
    if (ehUltimo) break

    // Pausa longa a cada BATCH_SIZE grupos (anti-ban principal)
    if ((i + 1) % BATCH_SIZE === 0) {
      const pausa = _rand(PAUSA_MIN, PAUSA_MAX)
      logStatus(
        `⏸  Anti-ban: pausa de ${Math.round(pausa / 1000)}s após ${i + 1} grupos...`,
        'yellow',
      )
      await _delay(pausa)
    } else {
      await _delay(_rand(DELAY_MIN, DELAY_MAX))
    }
  }

  // ── Retry — grupos com forbidden ──────────────────────────────────────
  // Grupos que fecham à noite podem reabrir em 3 min; vale a pena tentar.
  if (paraRetentar.size) {
    logStatus(
      `🔄 Retry: ${paraRetentar.size} grupo(s) forbidden — aguardar ${PAUSA_RETRY / 60_000} min...`,
      'yellow',
    )
    await _delay(PAUSA_RETRY)

    let retryOk = 0
    for (const [grupoId, idxSet] of paraRetentar) {
      for (const ti of idxSet) {
        const payloadFinal = { ...payloads[ti] }
        if (payloadFinal.text)    payloadFinal.text    = _variarTexto(payloadFinal.text)
        if (payloadFinal.caption) payloadFinal.caption = _variarTexto(payloadFinal.caption)

        const resultado = await _enviarParaGrupo(sock, grupoId, payloadFinal)

        if (resultado === 'ok') {
          stats[ti].enviados++
          stats[ti].erros = Math.max(0, stats[ti].erros - 1)
          resetarFalhasGrupo(grupoId)
          retryOk++
        } else if (resultado === 'not-member') {
          // Confirmado que o bot não está no grupo → desactivar
          setGrupoActivo(grupoId, false)
          logStatus(`🚫 Grupo removido (bot não é membro, confirmado no retry): ${grupoId}`, 'yellow')
          break  // não adianta tentar as outras tarefas para este grupo
        } else if (resultado === 'forbidden') {
          // Ainda restrito a admins → incrementar contador e possivelmente desactivar
          const totalFalhas = incrementarFalhasGrupo(grupoId)
          if (totalFalhas >= FALHAS_MAX) {
            setGrupoActivo(grupoId, false)
            logStatus(`🚫 Grupo desactivado após ${FALHAS_MAX} falhas consecutivas (só admins): ${grupoId}`, 'yellow')
          } else {
            logStatus(
              `⚠️  Grupo restrito a admins (${totalFalhas}/${FALHAS_MAX} falhas): ${grupoId}`,
              'yellow',
            )
          }
        }

        await _delay(_rand(3_000, 6_000))
      }
    }

    if (retryOk) logStatus(`✅ Retry: ${retryOk} envio(s) recuperado(s).`, 'green')
  }

  // ── Registar histórico + sumário final ────────────────────────────────
  const historicoCfg = getCfg('historico_activo')
  for (let ti = 0; ti < tarefas.length; ti++) {
    const { agId, enviados, erros } = stats[ti]
    logStatus(
      `✅ Cliente ${ti + 1}/${tarefas.length} (Ag #${agId ?? '?'}): ${enviados} enviados, ${erros} erros.`,
      'green',
    )
    if (historicoCfg) {
      registarHistorico({ agendamento_id: agId ?? null, grupos_atingidos: enviados, erros })
    }
  }

  return stats
}

// ── Wrapper retrocompatível para !divulgar e agendamentos simples ──────────
export async function broadcast(sock, { media_type, conteudo, caption }, grupos, agendamento_id = null) {
  if (!grupos.length) {
    logStatus('Broadcast: nenhum grupo activo.', 'yellow')
    return { enviados: 0, erros: 0 }
  }
  const [resultado] = await broadcastMulti(
    sock,
    [{ media_type, conteudo, caption, agId: agendamento_id }],
    grupos,
  )
  return { enviados: resultado.enviados, erros: resultado.erros }
}
