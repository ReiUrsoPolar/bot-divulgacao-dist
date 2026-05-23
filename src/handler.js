// src/handler.js
import { loadConfig, loadLoja, loadMsgs, saveConfig, saveLoja, CRIADOR } from './config.js'
import { logStatus } from './logger.js'
import {
  getCfg, setCfg, getAllCfg, getAllGrupos, getGruposActivos,
  cancelarTodos, pausarTodos,
  retomarTodos, criarAgendamento, cancelarAgendamento,
  getHistorico, getAgendamentosActivos,
  getClientesActivosDivulgacao, removerClienteDivulgacao,
  getRelatoriosCliente, getClienteDivulgacao,
  resolveLid,
} from './database.js'
import {
  sincronizarGrupos, adicionarGrupoDivulgacao, removerGrupoDivulgacao,
  getGruposParaEnvio, toggleGruposTodos, formatarListaGrupos
} from './groupManager.js'
import { broadcast } from './broadcaster.js'
import { tentarEntrarGrupos, extrairCodigosConvite } from './joiner.js'
import { checkLicenca, criarKey, revogarKey, listarClientes, getCriadorWA } from './licenca.js'
import { responderIA } from './ai.js'
import { handleCompraDM, iniciarCompra, iniciarPlano, iniciarAtualizacao, textoPlansDivulgacao, setUserState, getPlanosArquivo } from './compras.js'
import { downloadMedia } from './utils.js'

// ── Estado da fila injectado pelo index.js (evita import circular) ─────
let _getFilaStatus = () => ({ aCorrer: false, pendentes: 0, labels: [] })
export function setFilaStatusFn(fn) { _getFilaStatus = fn }

// ── Helpers de permissão ───────────────────────────────────────────────

// Limpa JIDs do WhatsApp e resolve LIDs (Privacy Mode do multi-device).
// Exemplos:
//   "351913579908:7@s.whatsapp.net" → "351913579908"
//   "735907749992931@lid"           → "351913579908" (via lid_map) ou "735907749992931"
function _normalize(num) {
  if (!num) return ''
  const raw = (num).replace(/:.*$/, '').split('@')
  const base   = raw[0]
  const domain = raw[1] ?? ''
  if (domain === 'lid') {
    // Tenta resolver LID → número de telefone persistido
    const resolved = resolveLid(base)
    return resolved ?? base   // se ainda não mapeado, devolve o próprio base LID
  }
  return base.replace(/\D/g, '')
}

function _isCriador(jid) {
  return _normalize(jid) === _normalize(CRIADOR)
}

function _isDono(jid) {
  const cfg  = loadConfig()
  const dono = _normalize(cfg.dono ?? '')
  return dono && _normalize(jid) === dono
}

// Criador tem sempre permissão total, independentemente do dono configurado
function _temPermissao(jid) {
  return _isCriador(jid) || _isDono(jid)
}

// _downloadMedia — alias local para a função partilhada (recebe msgInner)
const _downloadMedia = downloadMedia

// ── Boas-vindas automáticas ────────────────────────────────────────────
// Cooldown por número: não reenviar dentro de 6 horas
const _bvSent = new Map() // num → timestamp

function _deveEnviarBV(num) {
  const ts = _bvSent.get(num)
  return !ts || Date.now() - ts > 6 * 3_600_000
}

function _marcarBV(num) { _bvSent.set(num, Date.now()) }

async function _enviarBoasVindas(sock, jid, num) {
  _marcarBV(num)

  const cfg    = loadConfig()
  const prefix = cfg.prefix ?? '!'
  const wa     = getCriadorWA()
  const lista  = textoPlansDivulgacao(prefix)

  const texto =
    `📢 *Serviço de Divulgação WhatsApp*\n\n` +
    `Divulgamos o teu negócio em *centenas de grupos* automaticamente! 🚀\n\n` +
    `*Planos:*\n${lista}\n\n` +
    `👉 Para contratar, envia o comando do plano.\n` +
    `Dúvidas? wa.me/${wa}`

  await sock.sendMessage(jid, { text: texto })
}

// ── Mensagem de boas-vindas enviada ao comprador após activação ───────────
function _msgBoasVindasComprador(wa) {
  return (
    `✅ *Acesso activado!* 🎉\n\n` +

    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📥 *INSTALAÇÃO*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

    `*1. Descarrega o bot:*\n` +
    `   github.com/ReiUrsoPolar/bot-divulgacao-dist\n\n` +
    `*2. Instala as dependências:*\n` +
    `   \`npm install\`\n\n` +
    `*3. Substitui* \`config/bot.json\` *pelo ficheiro que vou enviar a seguir.*\n\n` +
    `*4. Arranca o bot:*\n` +
    `   \`node index.js\`\n` +
    `   → Escaneia o QR code com o WhatsApp\n\n` +

    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ *CONFIGURAÇÃO INICIAL*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

    `Depois de ligar, envia estes comandos ao bot:\n\n` +
    `*1. Sincronizar grupos:*\n` +
    `   \`!grupos\`\n\n` +
    `*2. Limite máximo de grupos (opcional):*\n` +
    `   \`!limite 200\`\n\n` +
    `*3. Entrar em grupos via link automaticamente (opcional):*\n` +
    `   \`!autoentrar on\`\n\n` +
    `*4. Sair de grupos sempre fechados (opcional):*\n` +
    `   \`!autosair on\`\n` +
    `   _Nota: grupos que fecham à noite e abrem de manhã não são afectados — o bot só verifica no momento de entrar._\n\n` +

    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📢 *DIVULGAR*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

    `• \`!divulgar [texto]\` — enviar agora\n` +
    `• \`!agendar 08:00 [texto]\` — agendar diariamente\n` +
    `• \`!intervalo 60 [texto]\` — enviar de 60 em 60 min\n` +
    `• \`!grupos todos\` — enviar para TODOS os grupos\n\n` +

    `📞 *Suporte:* wa.me/${wa}`
  )
}

// ── Handler principal ──────────────────────────────────────────────────
export async function handleMessage(sock, msg) {
  // jid começa como let — pode ser reescrito de @lid → @s.whatsapp.net abaixo
  let jid         = msg.key?.remoteJid
  const fromMe    = msg.key?.fromMe
  const isGroup   = jid?.endsWith('@g.us')

  // ── Resolver @lid → @s.whatsapp.net ─────────────────────────────────
  // WhatsApp Privacy Mode usa @lid como identificador alternativo.
  // sock.sendMessage para @lid pode falhar silenciosamente em algumas versões
  // do Baileys. Converter para @s.whatsapp.net garante entrega fiável.
  if (!isGroup && jid?.endsWith('@lid')) {
    const lidBase  = jid.replace(/:.*$/, '').split('@')[0]
    const resolved = resolveLid(lidBase)
    if (resolved) jid = `${resolved}@s.whatsapp.net`
    // Se ainda não mapeado, tenta de qualquer forma com o @lid original
  }

  // @lid é o identificador de privacidade do WhatsApp multi-device (equivalente a @s.whatsapp.net)
  const isPrivate = jid?.endsWith('@s.whatsapp.net') || jid?.endsWith('@lid')
  const senderJid = msg.key?.participant ?? jid ?? ''

  if (fromMe || !jid || (!isGroup && !isPrivate)) return

  // Extrai texto da mensagem
  const body = msg.message?.conversation
    ?? msg.message?.extendedTextMessage?.text
    ?? msg.message?.imageMessage?.caption
    ?? msg.message?.videoMessage?.caption
    ?? ''

  const cfg    = loadConfig()
  const prefix = cfg.prefix ?? '!'

  // ── Auto-entrada em grupos via link ───────────────────────────────────
  if (isGroup && getCfg('autoentrar')) {
    const codigos = extrairCodigosConvite(body)
    if (codigos.length) tentarEntrarGrupos(sock, codigos)
  }

  // ── PV para não-donos: state machine + comandos públicos + IA ────────
  if (isPrivate && !_temPermissao(senderJid)) {

    const senderNum = _normalize(senderJid)

    // Log no console para acompanhar mensagens recebidas no PV
    if (body) logStatus(`💬 PV +${senderNum}: ${body.slice(0, 60)}`, 'blue')

    // 1. State machine — processa respostas a fluxos em curso (ex: "aceito")
    //    DEVE correr antes de qualquer verificação de comando para não quebrar o fluxo.
    if (await handleCompraDM(sock, jid, senderNum, body, msg, prefix)) return

    // 2. Comandos públicos — qualquer pessoa pode usar !comprar / !plano
    if (body.startsWith(prefix)) {
      const _pArgs = body.slice(prefix.length).trim().split(/\s+/)
      const _pCmd  = _pArgs[0]?.toLowerCase()

      if (_pCmd === 'comprar') {
        await iniciarCompra(sock, jid, senderNum, _pArgs[1]?.toLowerCase(), prefix)
        return
      }
      if (_pCmd === 'plano') {
        await iniciarPlano(sock, jid, senderNum, _pArgs[1]?.toLowerCase(), prefix)
        return
      }
      if (_pCmd === 'atualizar' || _pCmd === 'mudar') {
        await iniciarAtualizacao(sock, jid, senderNum)
        return
      }

      if (_pCmd === 'relatorio' || _pCmd === 'relatório' || _pCmd === 'stats') {
        const cliente = getClienteDivulgacao(senderNum)
        if (!cliente || cliente.expira_em <= Date.now()) {
          await sock.sendMessage(jid, {
            text:
              `📭 Não tens nenhuma subscrição de divulgação activa.\n\n` +
              `Para contratar, usa \`${prefix}plano\`.`,
          })
          return
        }
        const relatorios = getRelatoriosCliente(senderNum, 7)
        const diasRestantes = Math.ceil((cliente.expira_em - Date.now()) / 86_400_000)
        const envDia        = Math.round(24 * 60 / cliente.intervalo_min)
        let txt =
          `📊 *Relatório de Divulgação*\n\n` +
          `📅 Plano: *${cliente.plano_key}* · ${envDia}×/dia\n` +
          `⏳ Expira em: *${diasRestantes} dias*\n\n`
        if (!relatorios.length) {
          txt += `_Nenhum envio registado ainda._`
        } else {
          txt += `*Últimos ${relatorios.length} envios:*\n`
          txt += relatorios.map((r, i) => {
            const d = new Date(r.enviado_em).toLocaleString('pt-PT', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })
            return `${i + 1}. ${d} — ✅ ${r.grupos_atingidos} grupos · ❌ ${r.erros} erros`
          }).join('\n')
        }
        await sock.sendMessage(jid, { text: txt })
        return
      }

      // Qualquer outro comando com prefixo → boas-vindas + aviso
      const donoConf = _normalize(loadConfig().dono ?? '')
      if (!donoConf) {
        await sock.sendMessage(jid, {
          text: '⚙️ Bot não configurado. Define o campo *"dono"* no bot.json com o teu número.',
        })
      } else {
        await _enviarBoasVindas(sock, jid, senderNum)
      }
      return
    }

    // 3. Mensagem livre (sem prefixo) — enviar boas-vindas se ainda não enviou
    if (body && _deveEnviarBV(senderNum)) {
      await _enviarBoasVindas(sock, jid, senderNum)
    }

    // 4. Notificar dono/criador se pv_notificar estiver activo
    if (getCfg('pv_notificar') && body) {
      const donoNum  = _normalize(loadConfig().dono ?? '') || _normalize(CRIADOR)
      const notifJid = donoNum ? `${donoNum}@s.whatsapp.net` : null
      if (notifJid && notifJid !== jid) {
        await sock.sendMessage(notifJid, {
          text: `📩 *Mensagem no PV do bot*\n\n👤 *De:* +${senderNum}\n💬 *Mensagem:* ${body}`
        })
      }
    }

    // 5. IA (se activa) — responde a mensagens livres (complementa as boas-vindas)
    if (getCfg('ia_activa') && body) {
      const resposta = await responderIA(body)
      if (resposta) await sock.sendMessage(jid, { text: resposta })
    }
    return
  }

  // ── State machine para dono/criador no PV (aceitar termos, etc.) ─────
  // Permite que o dono envie "aceito" sem prefixo e progrida em fluxos de compra/teste.
  if (isPrivate) {
    const sn = _normalize(senderJid)
    if (await handleCompraDM(sock, jid, sn, body, msg, prefix)) return
  }

  if (!body.startsWith(prefix)) return
  if (!_temPermissao(senderJid)) return  // em grupos, ignora silenciosamente não-donos

  // Criador bypassa sempre a verificação de licença — sem precisar de key nem de dono especial
  const licenca = _isCriador(senderJid) ? { valida: true } : checkLicenca()
  if (!licenca.valida) {
    const msgs = loadMsgs()
    await sock.sendMessage(jid, { text: msgs.semLicenca ?? '🔒 Licença inválida. Usa !renovar.' })
    return
  }

  const args = body.slice(prefix.length).trim().split(/\s+/)
  const cmd  = args[0].toLowerCase()

  // Log do comando recebido
  const origem = isGroup ? `grupo ${jid}` : `PV +${_normalize(senderJid)}`
  logStatus(`⌨️  Comando: ${body.slice(0, 60)} [${origem}]`, 'cyan')

  // ── Bare prefix (ex: "!") → mostrar ajuda ─────────────────────────────
  if (!cmd) {
    const msgs = loadMsgs()
    return sock.sendMessage(jid, { text: msgs.ajuda ?? `📋 Comandos disponíveis:\n\n!ajuda — ver todos os comandos\n!status — estado do bot\n!divulgar [texto] — enviar agora\n!grupos — sincronizar grupos\n!agendar HH:MM [texto] — agendar\n!intervalo <min> [texto] — repetir` })
  }

  // ── Comandos exclusivos do Criador — aviso se dono tentar usar ───────
  if (['addkey','revogar','clientes'].includes(cmd) && !_isCriador(senderJid)) {
    return sock.sendMessage(jid, { text: '❌ Este comando é exclusivo do criador.' })
  }

  if (cmd === 'addkey') {
    // Suporta tanto !addkey 351912345678 30dias como !addkey @pessoa 30dias (com menção)
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? []
    let numero, plano
    if (mentioned.length) {
      numero = mentioned[0].split(':')[0].split('@')[0]   // extrai número puro da JID
      // args: ['addkey', '@tag', 'plano'] ou ['addkey', 'plano'] (sem arg @)
      const firstIsAt = (args[1] ?? '').startsWith('@')
      plano = firstIsAt ? args[2] : args[1]
    } else {
      numero = args[1]
      plano  = args[2]
    }
    if (!numero || !plano) {
      return sock.sendMessage(jid, { text: '❌ Uso: !addkey <numero> <plano>\nOu menciona a pessoa: !addkey @pessoa mensal\nPlanos: mensal (15d), trimestral (45d), 30dias, 90dias, 180dias' })
    }
    const res = await criarKey(numero, plano)
    if (!res?.key) return sock.sendMessage(jid, { text: '❌ Erro ao gerar key. Verifica o plano e tenta novamente.' })

    // bot.json pré-configurado para enviar ao comprador
    const botJson = JSON.stringify({
      numero    : numero,
      licencaKey: res.key,
      geminiKey : '',
      dono      : numero,
      nomeBot   : 'Bot Divulgação',
      prefix    : '!',
    }, null, 2)
    const botJsonBuf = Buffer.from(botJson, 'utf8')

    // Confirmação para o criador
    await sock.sendMessage(jid, {
      text: `✅ *Key gerada!*\nNúmero: ${numero}\nPlano: ${plano}\nExpira: ${res.expiresAt ? new Date(res.expiresAt).toLocaleDateString('pt-PT') : '?'}\n\nKey: \`${res.key}\``
    })

    // Mensagem + bot.json configurado para o comprador
    await sock.sendMessage(numero + '@s.whatsapp.net', {
      text: _msgBoasVindasComprador(getCriadorWA()),
    })
    await sock.sendMessage(numero + '@s.whatsapp.net', {
      document : botJsonBuf,
      mimetype : 'application/json',
      fileName : 'bot.json',
      caption  : '📄 Coloca este ficheiro em config/bot.json e arranca o bot.',
    })
    return
  }

  if (cmd === 'revogar') {
    const key = args[1]
    if (!key) return sock.sendMessage(jid, { text: '❌ Uso: !revogar <keyId>' })
    const res = await revogarKey(key)
    return sock.sendMessage(jid, { text: res !== null ? '✅ Key revogada.' : '❌ Erro ao revogar.' })
  }

  if (cmd === 'clientes') {
    const lista = await listarClientes()
    if (!lista?.length) return sock.sendMessage(jid, { text: '📭 Nenhum cliente activo.' })
    const txt = lista.map((c, i) => {
      const num    = (c.cliente ?? '').replace('[DIV] ', '')
      const expira = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('pt-PT') : '?'
      return `${i+1}. ${num} — expira: ${expira}`
    }).join('\n')
    return sock.sendMessage(jid, { text: `👥 *Bot Divulgação — Clientes (${lista.length}):*\n\n${txt}` })
  }

  // ── Comandos de Dono/Criador ───────────────────────────────────────────

  // !comprar — apenas no PV do criador para testes; dono não tem acesso
  if (cmd === 'comprar' && isPrivate && _isCriador(senderJid)) {
    await iniciarCompra(sock, jid, _normalize(senderJid), args[1]?.toLowerCase(), prefix)
    return
  }

  if (cmd === 'plano') {
    const sub  = args[1]?.toLowerCase()
    const sub2 = args[2]?.toLowerCase()

    // ── Gestão de planos de divulgação (dono/criador) ──────────────────
    if (!sub || sub === 'list' || sub === 'lista') {
      const loja    = loadLoja()
      const entries = Object.entries(loja.planos_divulgacao ?? {})
      const mpOk    = !!getCfg('mp_token')
      if (!entries.length) {
        return sock.sendMessage(jid, {
          text:
            `📭 Nenhum plano de divulgação configurado.\n\n` +
            `_Usa: !plano add <key> <preco> <dias> <intervalo_min>_\n` +
            `_Ex: !plano add basico 50 30 60_`,
        })
      }
      const txt = entries
        .map(([k, p]) => {
          const env  = p.envios_dia ?? Math.round(24 * 60 / p.intervalo)
          const hApr = Math.round(24 / env)
          return `• *${k}* — ${p.nome}: R$ ${p.preco} / ${p.dias}d / *${env}× por dia* (~${hApr}h entre envios)`
        })
        .join('\n')
      return sock.sendMessage(jid, {
        text:
          `📢 *Planos de Divulgação:*\n\n${txt}\n\n` +
          `💳 Pagamento automático (MP): ${mpOk ? '✅ configurado' : '⭕ não configurado (!mptoken)'}\n\n` +
          `• !plano add <key> <preco> <dias> <envios_por_dia>\n` +
          `• !plano remove <key>\n` +
          `• !clientes_div — ver clientes activos`,
      })
    }

    if (sub === 'add') {
      // !plano add <key> <preco> <dias> <envios_por_dia> [Nome Bonito]
      const [,, key, precoStr, diasStr, enviosStr, ...nomeArr] = args
      const preco     = parseFloat(precoStr)
      const dias      = parseInt(diasStr, 10)
      const enviosDia = parseInt(enviosStr, 10)
      if (!key || isNaN(preco) || isNaN(dias) || isNaN(enviosDia) || preco <= 0 || dias <= 0 || enviosDia < 1 || enviosDia > 48) {
        return sock.sendMessage(jid, {
          text:
            '❌ Uso: !plano add <key> <preco> <dias> <envios_por_dia> [Nome]\n' +
            'Ex: !plano add basico 25 30 4 Plano Básico\n' +
            '    → 4 envios por dia, aprox. a cada 6h\n' +
            'Ex: !plano add pro 60 90 8\n' +
            '    → 8 envios por dia, aprox. a cada 3h',
        })
      }
      const intervalo = Math.floor(24 * 60 / enviosDia)
      const horasAprox = Math.round(24 / enviosDia)
      const nome   = nomeArr.length ? nomeArr.join(' ') : (key.charAt(0).toUpperCase() + key.slice(1))
      const loja   = loadLoja()
      const planos = loja.planos_divulgacao ?? {}
      planos[key]  = { nome, preco, dias, envios_dia: enviosDia, intervalo }
      saveLoja({ planos_divulgacao: planos })
      return sock.sendMessage(jid, {
        text: `✅ Plano *${nome}* (\`${key}\`) adicionado:\nR$ ${preco} · ${dias} dias · *${enviosDia}× por dia* (~${horasAprox}h entre envios)\n\nClientes usam: \`!plano ${key}\``,
      })
    }

    if (sub === 'remove' || sub === 'remover') {
      const key = args[2]
      if (!key) return sock.sendMessage(jid, { text: '❌ Uso: !plano remove <key>' })
      const loja   = loadLoja()
      const planos = loja.planos_divulgacao ?? {}
      if (!planos[key]) return sock.sendMessage(jid, { text: `❌ Plano *${key}* não encontrado.` })
      delete planos[key]
      saveLoja({ planos_divulgacao: planos })
      return sock.sendMessage(jid, { text: `✅ Plano *${key}* removido.` })
    }

    // !plano <key> no PV → iniciar compra (teste)
    if (isPrivate && sub && !['add','remove','remover','list','lista'].includes(sub)) {
      await iniciarPlano(sock, jid, _normalize(senderJid), sub, prefix)
      return
    }

    return sock.sendMessage(jid, {
      text: '❌ Uso: !plano · !plano add <key> <preco> <dias> <intervalo> · !plano remove <key>',
    })
  }

  // ── Chave Pix do dono (para fallback manual de pagamento) ────────────
  if (cmd === 'pixkey') {
    const key = args.slice(1).join(' ').trim()
    if (!key) {
      const atual = loadLoja().pixKey ?? '(não configurada)'
      return sock.sendMessage(jid, {
        text:
          `💳 *Chave Pix actual:* ${atual}\n\n` +
          `Para alterar:\n!pixkey <chave>\n` +
          `Ex: !pixkey 11912345678\nEx: !pixkey meu@email.com`,
      })
    }
    saveLoja({ pixKey: key })
    return sock.sendMessage(jid, {
      text: `✅ Chave Pix guardada: *${key}*\nÉ mostrada automaticamente quando alguém compra sem Mercado Pago.`,
    })
  }

  // ── Confirmar venda manual de arquivo (bot software) ─────────────────
  // Usado quando o pagamento é manual (sem MP token) e o criador confirma.
  // !confirmar <numero> <plano>
  if (cmd === 'confirmar') {
    if (!_isCriador(senderJid)) {
      return sock.sendMessage(jid, { text: '❌ Este comando é exclusivo do criador.' })
    }
    const numero        = (args[1] ?? '').replace(/\D/g, '')
    const plano         = args[2]
    const planosArquivo = getPlanosArquivo()
    if (!numero || !plano || !planosArquivo[plano]) {
      const planosDisp = Object.keys(planosArquivo).join(', ')
      return sock.sendMessage(jid, {
        text: `❌ Uso: !confirmar <numero> <plano>\nPlanos: ${planosDisp}`,
      })
    }
    const planInfo = planosArquivo[plano]
    const res = await criarKey(numero, plano)
    if (!res?.key) {
      return sock.sendMessage(jid, { text: '❌ Erro ao gerar key. Verifica a API do criador.' })
    }
    const botJson = JSON.stringify({
      numero, licencaKey: res.key, geminiKey: '',
      dono: numero, nomeBot: 'Bot Divulgação', prefix: '!',
    }, null, 2)
    const compradorJid = `${numero}@s.whatsapp.net`
    // Confirmação para o criador
    await sock.sendMessage(jid, {
      text:
        `✅ Venda confirmada!\n` +
        `Número: +${numero}\nPlano: ${planInfo.nome}\n` +
        `Expira: ${res.expiresAt ? new Date(res.expiresAt).toLocaleDateString('pt-PT') : '?'}\n\n` +
        `Key: \`${res.key}\``,
    })
    // Enviar instruções + bot.json ao comprador
    await sock.sendMessage(compradorJid, { text: _msgBoasVindasComprador(getCriadorWA()) })
    await sock.sendMessage(compradorJid, {
      document: Buffer.from(botJson, 'utf8'),
      mimetype: 'application/json',
      fileName: 'bot.json',
      caption : '📄 Coloca este ficheiro em config/bot.json e arranca o bot.',
    })
    return
  }

  // ── Confirmar subscrição manual de divulgação ─────────────────────────
  // Usado quando o pagamento de divulgação é manual (sem MP token no dono).
  // !confirmar_div <numero> <plano>
  if (cmd === 'confirmar_div' || cmd === 'confirmardiv') {
    const numero = (args[1] ?? '').replace(/\D/g, '')
    const plano  = args[2]
    const loja   = loadLoja()
    if (!numero || !plano || !loja.planos_divulgacao?.[plano]) {
      const planosDisp = Object.keys(loja.planos_divulgacao ?? {}).join(', ') || '(nenhum)'
      return sock.sendMessage(jid, {
        text: `❌ Uso: !confirmar_div <numero> <plano>\nPlanos: ${planosDisp}`,
      })
    }
    const planInfo    = loja.planos_divulgacao[plano]
    const compradorJid = `${numero}@s.whatsapp.net`
    // Pedir conteúdo ao cliente
    setUserState(numero, 'DIVULG_CONTEUDO', { planoKey: plano, planInfo })
    await sock.sendMessage(compradorJid, {
      text:
        `✅ *Pagamento confirmado!* 🎉\n\n` +
        `📢 *Plano ${planInfo.nome}* activado!\n` +
        `⏱️ Envio a cada *${planInfo.intervalo} min* · 📅 *${planInfo.dias} dias*\n\n` +
        `📩 *Envia agora a mensagem ou mídia que queres divulgar:*\n` +
        `_(Podes enviar texto, imagem, vídeo ou documento)_`,
    })
    return sock.sendMessage(jid, {
      text: `✅ Subscrição activada para +${numero} (${planInfo.nome}).\nAguarda que o cliente envie o conteúdo.`,
    })
  }

  // ── Token Mercado Pago do dono (pagamentos automáticos de divulgação) ─
  if (cmd === 'maxenvio') {
    const n = parseInt(args[1], 10)
    if (isNaN(n) || n < 1 || n > 500)
      return sock.sendMessage(jid, {
        text:
          `❌ Uso: !maxenvio <numero>\n\n` +
          `Define quantos grupos são atingidos por cada envio.\n` +
          `Actual: *${getCfg('max_por_envio') ?? 60}*\n\n` +
          `💡 Com 100 grupos o broadcast demora ~35 min.\n` +
          `Usa !intervalo 90 para deixar margem entre envios.`,
      })
    const estimMin = Math.ceil((n * 14 + Math.floor(n / 15) * 180) / 60)
    setCfg('max_por_envio', n)
    return sock.sendMessage(jid, {
      text:
        `✅ Máximo por envio: *${n} grupos* (~${estimMin} min por broadcast)\n\n` +
        (n > 100
          ? `⚠️ Acima de 100 grupos o risco de ban aumenta. Usa !intervalo ${estimMin * 2} ou mais.`
          : `💡 Usa *!intervalo ${estimMin + 30}* para deixar margem entre envios.`),
    })
  }

  if (cmd === 'aceitarlinks') {
    const val = args[1]?.toLowerCase()
    if (val !== 'on' && val !== 'off')
      return sock.sendMessage(jid, { text: '❌ Uso: !aceitarlinks on/off' })
    setCfg('aceitar_links', val === 'on')
    return sock.sendMessage(jid, {
      text: val === 'on'
        ? `✅ *Links permitidos.* Clientes podem divulgar mensagens com links.`
        : `✅ *Links bloqueados.* Mensagens com links serão recusadas — o cliente terá de reenviar sem links.\n\n_Os termos já mostram este aviso automaticamente._`,
    })
  }

  if (cmd === 'mptoken') {
    const token = args[1]
    if (!token) {
      return sock.sendMessage(jid, {
        text:
          '❌ Uso: !mptoken <ACCESS_TOKEN>\n\n' +
          'Obtém o token em:\nmercadopago.com.br → Credenciais → Access Token',
      })
    }
    setCfg('mp_token', token)
    return sock.sendMessage(jid, {
      text: '✅ *Mercado Pago configurado!*\nOs pagamentos de divulgação são agora automáticos via Pix. 🎉',
    })
  }

  // ── Ver clientes activos de divulgação ─────────────────────────────
  if (cmd === 'clientes_div' || cmd === 'clientesdiv') {
    const lista = getClientesActivosDivulgacao()
    if (!lista.length) return sock.sendMessage(jid, { text: '📭 Nenhum cliente de divulgação activo.' })
    const now = Date.now()
    const txt = lista.map((c, i) => {
      const dias    = Math.ceil((c.expira_em - now) / 86_400_000)
      const envDia  = Math.round(24 * 60 / c.intervalo_min)
      return `${i + 1}. +${c.numero} — ${c.plano_key} · ${envDia}×/dia · ${dias}d restantes`
    }).join('\n')
    return sock.sendMessage(jid, {
      text: `📢 *Clientes de Divulgação (${lista.length}):*\n\n${txt}\n\n_!expulsar <numero> para remover_`,
    })
  }

  // ── Remover cliente de divulgação ──────────────────────────────────
  // ── Relatório de divulgação de um cliente (dono) ──────────────────────
  // !relatorio <numero> [limit]
  if (cmd === 'relatorio' || cmd === 'relatório') {
    const num   = _normalize(args[1])
    const limit = parseInt(args[2], 10) || 7
    if (!num) return sock.sendMessage(jid, { text: '❌ Uso: !relatorio <numero> [ultimos N envios]' })
    const cliente = getClienteDivulgacao(num)
    if (!cliente) return sock.sendMessage(jid, { text: `❌ Cliente +${num} não encontrado.` })
    const relatorios    = getRelatoriosCliente(num, limit)
    const diasRestantes = Math.max(0, Math.ceil((cliente.expira_em - Date.now()) / 86_400_000))
    const envDia        = Math.round(24 * 60 / cliente.intervalo_min)
    let txt =
      `📊 *Relatório — +${num}*\n\n` +
      `📅 Plano: *${cliente.plano_key}* · ${envDia}×/dia\n` +
      `⏳ Expira em: *${diasRestantes} dias*\n\n`
    if (!relatorios.length) {
      txt += `_Nenhum envio registado._`
    } else {
      txt += `*Últimos ${relatorios.length} envios:*\n`
      txt += relatorios.map((r, i) => {
        const d = new Date(r.enviado_em).toLocaleString('pt-PT', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        })
        return `${i + 1}. ${d} — ✅ ${r.grupos_atingidos} grupos · ❌ ${r.erros} erros`
      }).join('\n')
    }
    return sock.sendMessage(jid, { text: txt })
  }

  if (cmd === 'expulsar') {
    const num = _normalize(args[1])
    if (!num) return sock.sendMessage(jid, { text: '❌ Uso: !expulsar <numero>' })
    removerClienteDivulgacao(num)
    return sock.sendMessage(jid, { text: `✅ Cliente +${num} removido e divulgação cancelada.` })
  }

  if (cmd === 'divulgar') {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
    let payload

    if (quoted) {
      const media = await _downloadMedia(quoted)
      if (media) {
        payload = { media_type: media.media_type, conteudo: media.buffer, caption: media.caption }
      } else {
        const txt = quoted.conversation ?? quoted.extendedTextMessage?.text ?? ''
        payload = { media_type: 'text', conteudo: txt, caption: '' }
      }
    } else {
      // slice directo do body para preservar newlines/parágrafos
      const texto = body.slice(prefix.length).trimStart().slice(cmd.length).trim()
      if (!texto) return sock.sendMessage(jid, { text: '❌ Uso: !divulgar [texto] ou faz reply a uma media' })
      payload = { media_type: 'text', conteudo: texto, caption: '' }
    }

    await sock.sendMessage(jid, { text: '⏳ A enviar...' })
    const grupos  = getGruposParaEnvio()
    const { enviados, erros } = await broadcast(sock, payload, grupos)
    return sock.sendMessage(jid, { text: `✅ Enviado para ${enviados} grupos. Erros: ${erros}.` })
  }

  if (cmd === 'agendar') {
    const hora  = args[1]
    if (!hora || !/^\d{2}:\d{2}$/.test(hora))
      return sock.sendMessage(jid, { text: '❌ Uso: !agendar HH:MM [texto] ou faz reply a uma media' })
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
    let media_type = 'text', conteudo, caption = ''
    if (quoted) {
      const m = await _downloadMedia(quoted)
      if (m) { media_type = m.media_type; conteudo = m.buffer; caption = m.caption }
      else { conteudo = quoted.conversation ?? '' }
    } else {
      // tudo após "!agendar HH:MM " preservando parágrafos
      conteudo = body.slice(prefix.length).trimStart().replace(/^\S+\s+\S+\s*/, '')
      if (!conteudo) return sock.sendMessage(jid, { text: '❌ Indica o texto ou faz reply a uma media.' })
    }
    const id = criarAgendamento({ tipo: 'hora', valor: hora, media_type, conteudo, caption })
    return sock.sendMessage(jid, { text: `✅ Agendamento #${id} criado para as ${hora} todos os dias.` })
  }

  if (cmd === 'intervalo') {
    const mins = parseInt(args[1], 10)
    if (!mins || isNaN(mins) || mins < 1)
      return sock.sendMessage(jid, { text: '❌ Uso: !intervalo <minutos> [texto] ou faz reply' })
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
    let media_type = 'text', conteudo, caption = ''
    if (quoted) {
      const m = await _downloadMedia(quoted)
      if (m) { media_type = m.media_type; conteudo = m.buffer; caption = m.caption }
      else { conteudo = quoted.conversation ?? '' }
    } else {
      // tudo após "!intervalo <min> " preservando parágrafos
      conteudo = body.slice(prefix.length).trimStart().replace(/^\S+\s+\S+\s*/, '')
      if (!conteudo) return sock.sendMessage(jid, { text: '❌ Indica o texto ou faz reply a uma media.' })
    }
    const id       = criarAgendamento({ tipo: 'intervalo', valor: String(mins), media_type, conteudo, caption })
    const maxEnvio = parseInt(getCfg('max_por_envio') ?? '60', 10)
    // Estimar tempo de broadcast: (maxEnvio × 14s) + pauses (2 pauses × 3min para 60 grupos)
    const estimMin = Math.ceil((maxEnvio * 14 + Math.floor(maxEnvio / 15) * 180) / 60)
    const aviso    = mins < estimMin
      ? `\n\n⚠️ *Atenção:* o broadcast de ${maxEnvio} grupos demora ~${estimMin} min. Com intervalo de ${mins} min os envios vão ficar sobrepostos.\n_Recomendado: !intervalo ${estimMin * 2} ou !maxenvio ${Math.floor(mins * 60 / 14)}_`
      : ''
    return sock.sendMessage(jid, { text: `✅ Intervalo #${id} criado: envia a cada ${mins} minutos.${aviso}` })
  }

  if (cmd === 'fila') {
    const fila = _getFilaStatus()
    if (!fila.aCorrer && !fila.pendentes) {
      return sock.sendMessage(jid, { text: '✅ Nenhum broadcast em curso ou na fila.' })
    }
    const linhas = []
    if (fila.aCorrer) {
      linhas.push(`▶️ *A correr agora:* ${fila.labelActual ?? '(broadcast activo)'}`)
    }
    if (fila.pendentes) {
      linhas.push(`\n⏳ *Na fila (${fila.pendentes}):*`)
      fila.labels.forEach((l, i) => linhas.push(`   ${i + 1}. ${l}`))
    }
    return sock.sendMessage(jid, { text: linhas.join('\n') })
  }

  if (cmd === 'pausar') {
    pausarTodos()
    return sock.sendMessage(jid, { text: '⏸️ Todos os agendamentos pausados.' })
  }

  if (cmd === 'retomar') {
    retomarTodos()
    return sock.sendMessage(jid, { text: '▶️ Agendamentos retomados.' })
  }

  if (cmd === 'cancelar') {
    const id = parseInt(args[1], 10)
    if (id) {
      cancelarAgendamento(id)
      return sock.sendMessage(jid, { text: `🗑️ Agendamento #${id} cancelado.` })
    }
    cancelarTodos()
    return sock.sendMessage(jid, { text: '🗑️ Todos os agendamentos cancelados.' })
  }

  if (cmd === 'grupos') {
    const sub = args[1]?.toLowerCase()
    if (!sub) {
      await sincronizarGrupos(sock)
      const lista = getAllGrupos()
      return sock.sendMessage(jid, { text: `👥 *Grupos (${lista.length}):*\n\n${formatarListaGrupos(lista)}` })
    }
    if (sub === 'lista') {
      const lista = getGruposActivos()
      return sock.sendMessage(jid, { text: `📋 *Grupos para divulgar (${lista.length}):*\n\n${formatarListaGrupos(lista)}` })
    }
    if (sub === 'todos') {
      const actual = getCfg('grupos_todos')
      toggleGruposTodos(!actual)
      return sock.sendMessage(jid, { text: `✅ Divulgar para TODOS os grupos: ${!actual ? 'ON' : 'OFF'}` })
    }
    if (sub === 'add') {
      const id = args[2]
      if (!id) return sock.sendMessage(jid, { text: '❌ Uso: !grupos add <id>' })
      const ok = adicionarGrupoDivulgacao(id)
      return sock.sendMessage(jid, { text: ok ? `✅ Grupo adicionado.` : `❌ Grupo não encontrado na DB. Faz !grupos primeiro.` })
    }
    if (sub === 'remove') {
      const id = args[2]
      if (!id) return sock.sendMessage(jid, { text: '❌ Uso: !grupos remove <id>' })
      removerGrupoDivulgacao(id)
      return sock.sendMessage(jid, { text: `✅ Grupo removido da divulgação.` })
    }
    return sock.sendMessage(jid, { text: '❌ Sub-comandos: lista, todos, add, remove' })
  }

  if (cmd === 'autoentrar') {
    const val = args[1]?.toLowerCase()
    if (val !== 'on' && val !== 'off')
      return sock.sendMessage(jid, { text: '❌ Uso: !autoentrar on/off' })
    setCfg('autoentrar', val === 'on')
    return sock.sendMessage(jid, { text: `✅ Auto-entrar em grupos: ${val.toUpperCase()}` })
  }

  if (cmd === 'autosair') {
    const val = args[1]?.toLowerCase()
    if (val !== 'on' && val !== 'off')
      return sock.sendMessage(jid, { text: '❌ Uso: !autosair on/off' })
    setCfg('autosair', val === 'on')
    return sock.sendMessage(jid, { text: `✅ Auto-sair de grupos fechados: ${val.toUpperCase()}` })
  }

  if (cmd === 'limite') {
    const n = parseInt(args[1], 10)
    if (isNaN(n) || n < 1) return sock.sendMessage(jid, { text: '❌ Uso: !limite <numero>' })
    setCfg('limite_grupos', n)
    return sock.sendMessage(jid, { text: `✅ Limite de grupos: ${n}` })
  }

  if (cmd === 'historico') {
    const sub = args[1]?.toLowerCase()
    if (sub === 'on' || sub === 'off') {
      setCfg('historico_activo', sub === 'on')
      return sock.sendMessage(jid, { text: `✅ Registo de histórico: ${sub.toUpperCase()}` })
    }
    const hist = getHistorico(10)
    if (!hist.length) return sock.sendMessage(jid, { text: '📭 Nenhum envio registado.' })
    const txt = hist.map((h, i) => {
      const d = new Date(h.enviado_em).toLocaleString('pt-PT')
      return `${i+1}. ${d} — ${h.grupos_atingidos} grupos, ${h.erros} erros`
    }).join('\n')
    return sock.sendMessage(jid, { text: `📊 *Últimos envios:*\n\n${txt}` })
  }

  if (cmd === 'ia') {
    const val = args[1]?.toLowerCase()
    if (val !== 'on' && val !== 'off')
      return sock.sendMessage(jid, { text: '❌ Uso: !ia on/off' })
    setCfg('ia_activa', val === 'on')
    return sock.sendMessage(jid, { text: `✅ IA no PV: ${val.toUpperCase()}` })
  }

  if (cmd === 'pv') {
    const sub  = args[1]?.toLowerCase()
    const sub2 = args[2]?.toLowerCase()

    // Mostrar estado actual
    if (!sub) {
      const pvActivo = getCfg('pv_activo') !== false   // null = ON por omissão
      const pvNotif  = !!getCfg('pv_notificar')
      return sock.sendMessage(jid, {
        text:
          `📱 *Configuração do PV:*\n\n` +
          `• Responder no PV: ${pvActivo ? '✅ ON' : '⭕ OFF'}\n` +
          `• Notificar quando alguém escreve: ${pvNotif ? '✅ ON' : '⭕ OFF'}\n\n` +
          `_Comandos:_\n` +
          `• \`!pv on/off\` — activar/desactivar respostas no PV\n` +
          `• \`!pv notificar on/off\` — receber aviso de quem escreve`
      })
    }

    // !pv on / !pv off
    if ((sub === 'on' || sub === 'off') && !sub2) {
      setCfg('pv_activo', sub === 'on')
      return sock.sendMessage(jid, {
        text: sub === 'on'
          ? `✅ Bot volta a responder no PV.`
          : `✅ Bot deixou de responder no PV.\n_Usa \`!pv notificar on\` para receberes aviso quando alguém escrever._`
      })
    }

    // !pv notificar on / !pv notificar off
    if (sub === 'notificar' && (sub2 === 'on' || sub2 === 'off')) {
      setCfg('pv_notificar', sub2 === 'on')
      return sock.sendMessage(jid, {
        text: sub2 === 'on'
          ? `✅ Vais receber uma notificação aqui sempre que alguém escrever ao bot no PV.`
          : `✅ Notificações de PV desactivadas.`
      })
    }

    return sock.sendMessage(jid, { text: '❌ Uso: !pv · !pv on/off · !pv notificar on/off' })
  }

  if (cmd === 'dono') {
    const num = args[1]
    if (!num) return sock.sendMessage(jid, { text: '❌ Uso: !dono <numero>' })
    saveConfig({ dono: _normalize(num) })
    return sock.sendMessage(jid, { text: `✅ Dono definido: ${num}` })
  }

  if (cmd === 'renovar') {
    const msgs = loadMsgs()
    // Contacto do criador vem sempre do código ofuscado — nunca de ficheiros editáveis pelo dono
    const txt = (msgs.renovar ?? '🔄 Para renovar a tua licença, fala com o suporte:\nwa.me/{wa}')
      .replace('{wa}', getCriadorWA())
    return sock.sendMessage(jid, { text: txt })
  }

  if (cmd === 'status') {
    const lic      = checkLicenca()
    const cfgAll   = getAllCfg()
    const ags      = getAgendamentosActivos()
    const grupos   = getGruposActivos()
    const txt = [
      `🤖 *Bot Divulgação — Status*`,
      ``,
      `🔑 Licença: ${lic.valida ? `✅ ${lic.cliente} (${lic.diasRestantes}d)` : `❌ ${lic.motivo}`}`,
      `👥 Grupos na lista: ${grupos.length}`,
      `⏰ Agendamentos activos: ${ags.length}`,
      (() => {
        const f = _getFilaStatus()
        if (!f.aCorrer && !f.pendentes) return `📤 Broadcasts: sem actividade`
        const partes = []
        if (f.aCorrer)   partes.push(`▶️ a correr`)
        if (f.pendentes) partes.push(`${f.pendentes} na fila`)
        return `📤 Broadcasts: ${partes.join(' + ')} (!fila para detalhes)`
      })(),
      `🤖 IA no PV: ${cfgAll.ia_activa ? 'ON' : 'OFF'}`,
      `📱 Responder no PV: ${cfgAll.pv_activo !== false ? 'ON' : 'OFF'}`,
      `🔔 Notificar PV: ${cfgAll.pv_notificar ? 'ON' : 'OFF'}`,
      `💳 Pagamento MP: ${cfgAll.mp_token ? '✅ configurado' : '⭕ não config.'}`,
      `🔗 Links na divulgação: ${cfgAll.aceitar_links !== false ? '✅ permitidos' : '⭕ bloqueados'}`,
      `📨 Máx. grupos por envio: ${cfgAll.max_por_envio ?? 40}`,
      `🔗 Auto-entrar: ${cfgAll.autoentrar ? 'ON' : 'OFF'}`,
      `🚪 Auto-sair (fechados): ${cfgAll.autosair ? 'ON' : 'OFF'}`,
      `📊 Histórico: ${cfgAll.historico_activo ? 'ON' : 'OFF'}`,
      `🌍 Divulgar todos: ${cfgAll.grupos_todos ? 'ON' : 'OFF'}`,
      `📏 Limite grupos: ${cfgAll.limite_grupos}`,
    ].join('\n')
    return sock.sendMessage(jid, { text: txt })
  }

  if (cmd === 'config') {
    const sub = args[1]?.toLowerCase()
    const OPCOES_TOGGLE = ['autoentrar','autosair','ia_activa','historico_activo','grupos_todos']
    if (!sub) {
      const cfgAll = getAllCfg()
      const linhas = OPCOES_TOGGLE.map(k => `• ${k}: ${cfgAll[k] ? '✅ ON' : '⭕ OFF'}`)
      linhas.push(`• limite_grupos: ${cfgAll.limite_grupos}`)
      return sock.sendMessage(jid, { text: `⚙️ *Configurações:*\n\n${linhas.join('\n')}` })
    }
    const val = args[2]?.toLowerCase()
    if (OPCOES_TOGGLE.includes(sub) && (val === 'on' || val === 'off')) {
      setCfg(sub, val === 'on')
      return sock.sendMessage(jid, { text: `✅ ${sub}: ${val.toUpperCase()}` })
    }
    return sock.sendMessage(jid, { text: `❌ Uso: !config <opcao> on/off\nOpções: ${OPCOES_TOGGLE.join(', ')}` })
  }

  if (cmd === 'ajuda' || cmd === 'menu' || cmd === 'help') {
    const msgs = loadMsgs()
    const ajudaTxt = msgs.ajuda ??
      `📋 *Comandos disponíveis:*\n\n` +
      `*📢 Divulgação*\n` +
      `• \`${prefix}divulgar [texto]\` — enviar agora\n` +
      `• \`${prefix}agendar HH:MM [texto]\` — agendar diariamente\n` +
      `• \`${prefix}intervalo <min> [texto]\` — repetir a cada N minutos\n` +
      `• \`${prefix}pausar\` / \`${prefix}retomar\` — pausar/retomar\n` +
      `• \`${prefix}cancelar [id]\` — cancelar agendamento(s)\n` +
      `• \`${prefix}fila\` — ver broadcasts em curso\n\n` +
      `*👥 Grupos*\n` +
      `• \`${prefix}grupos\` — sincronizar grupos\n` +
      `• \`${prefix}grupos lista\` — ver lista activa\n` +
      `• \`${prefix}grupos todos\` — toggle todos os grupos\n` +
      `• \`${prefix}grupos add/remove <id>\`\n\n` +
      `*⚙️ Configurações*\n` +
      `• \`${prefix}status\` — estado geral do bot\n` +
      `• \`${prefix}config\` — configurações avançadas\n` +
      `• \`${prefix}limite <n>\` — máx. grupos\n` +
      `• \`${prefix}maxenvio <n>\` — grupos por broadcast\n` +
      `• \`${prefix}autoentrar on/off\`\n` +
      `• \`${prefix}autosair on/off\`\n` +
      `• \`${prefix}aceitarlinks on/off\`\n` +
      `• \`${prefix}historico on/off\`\n\n` +
      `*💳 Divulgação para clientes*\n` +
      `• \`${prefix}plano\` — ver/gerir planos\n` +
      `• \`${prefix}clientes_div\` — clientes activos\n` +
      `• \`${prefix}relatorio <numero>\` — relatório de cliente\n` +
      `• \`${prefix}expulsar <numero>\` — remover cliente\n` +
      `• \`${prefix}confirmar_div <numero> <plano>\` — confirmar pagamento manual\n\n` +
      `_Envia \`${prefix}status\` para ver o estado actual._`
    return sock.sendMessage(jid, { text: ajudaTxt })
  }

  // ── Catch-all — comando não reconhecido ───────────────────────────────
  // Sempre responder ao dono/criador — nunca silêncio total.
  return sock.sendMessage(jid, {
    text:
      `❓ Comando \`${prefix}${cmd}\` não reconhecido.\n\n` +
      `Usa \`${prefix}ajuda\` para ver todos os comandos disponíveis.`,
  })
}
