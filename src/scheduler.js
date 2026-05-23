// src/scheduler.js
import { getAgendamentosActivos, updateUltimoEnvio, limparClientesExpirados } from './database.js'
import { broadcastMulti } from './broadcaster.js'
import { getGruposParaEnvio } from './groupManager.js'
import { logStatus } from './logger.js'

let _sock     = null
let _intervId = null

// ── Fila de broadcasts — execução sequencial ──────────────────────────────
// Com interleaving, UMA entrada na fila = todos os clientes prontos naquele tick.
// Não é necessária pausa entre entradas porque o interleaving já distribui os envios.
const _fila        = []   // [{ label, agIds, fn }]
let _aCorrer       = false
let _labelActual   = null  // label do broadcast em execução

// Estado público — consumido por !status e !fila
export function getFilaStatus() {
  return {
    aCorrer    : _aCorrer,
    labelActual: _labelActual,
    pendentes  : _fila.length,
    labels     : _fila.map(t => t.label),
  }
}

async function _delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function _processarFila() {
  if (_aCorrer || !_fila.length) return
  _aCorrer = true
  try {
    while (_fila.length) {
      const tarefa   = _fila.shift()
      _labelActual   = tarefa.label
      logStatus(`▶️  A iniciar broadcast: ${tarefa.label}`, 'cyan')
      await tarefa.fn()
      _labelActual = null
    }
  } finally {
    _aCorrer     = false
    _labelActual = null
  }
}

export function iniciarScheduler(sock) {
  _sock = sock
  if (_intervId) clearInterval(_intervId)
  _intervId = setInterval(_tick, 60_000)
  logStatus('⏱️  Scheduler iniciado.', 'cyan')
}

export function pararScheduler() {
  if (_intervId) { clearInterval(_intervId); _intervId = null }
}

async function _tick() {
  // Limpar subscrições de divulgação expiradas
  const nExp = limparClientesExpirados()
  if (nExp) logStatus(`🗑️  ${nExp} subscrição(ões) de divulgação expirada(s) removida(s).`, 'yellow')

  const agendamentos = getAgendamentosActivos()
  if (!agendamentos.length) return

  const agora      = new Date()
  const horaActual = `${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')}`

  // ── Recolher TODOS os agendamentos prontos neste tick ─────────────────
  const prontos = []
  for (const ag of agendamentos) {
    let deveDisparar = false

    if (ag.tipo === 'hora') {
      deveDisparar = ag.valor === horaActual
    } else if (ag.tipo === 'intervalo') {
      const intervMs = parseInt(ag.valor, 10) * 60_000
      deveDisparar   = Date.now() - ag.ultimo_env >= intervMs
    }

    if (!deveDisparar) continue

    // Actualizar ultimo_env IMEDIATAMENTE — impede re-disparo durante a execução
    updateUltimoEnvio(ag.id)
    prontos.push({ ...ag })
  }

  if (!prontos.length) return

  // ── Protecção contra entradas duplicadas ──────────────────────────────
  // Se TODOS os agIds já estão na fila (noutro bundle), ignorar.
  const agIdsNovos   = new Set(prontos.map(ag => ag.id))
  const agIdsNaFila  = new Set(_fila.flatMap(t => t.agIds ?? []))
  const todosNaFila  = prontos.every(ag => agIdsNaFila.has(ag.id))
  if (todosNaFila) return

  // Filtrar agendamentos que já estão na fila para evitar duplicados parciais
  const prontosFiltrados = prontos.filter(ag => !agIdsNaFila.has(ag.id))
  if (!prontosFiltrados.length) return

  // ── Criar UMA entrada com todos os agendamentos prontos ───────────────
  const label = prontosFiltrados.length === 1
    ? `Ag #${prontosFiltrados[0].id} (${prontosFiltrados[0].tipo}: ${prontosFiltrados[0].valor}min)`
    : `${prontosFiltrados.length} campanhas simultâneas (Ag ${prontosFiltrados.map(a => '#' + a.id).join(', ')})`

  logStatus(`⏰ ${label} — adicionado à fila (posição ${_fila.length + 1})`, 'cyan')

  _fila.push({
    label,
    agIds: prontosFiltrados.map(ag => ag.id),
    fn: async () => {
      const grupos  = getGruposParaEnvio()
      const tarefas = prontosFiltrados.map(ag => ({
        media_type: ag.media_type,
        conteudo  : ag.conteudo,
        caption   : ag.caption,
        agId      : ag.id,
      }))
      await broadcastMulti(_sock, tarefas, grupos)
    },
  })

  // Processar fila (non-blocking — não segura o tick seguinte)
  _processarFila().catch(e => logStatus(`Erro no scheduler: ${e?.message}`, 'red'))
}
