// src/database.js
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join }  from 'path'
import { mkdirSync }      from 'fs'

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..')
const DB_DIR = join(ROOT, 'database')
mkdirSync(DB_DIR, { recursive: true })

const db = new Database(join(DB_DIR, 'divulgacao.sqlite'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS grupos (
    id                   TEXT PRIMARY KEY,
    nome                 TEXT NOT NULL DEFAULT '',
    activo               INTEGER NOT NULL DEFAULT 0,
    entrou_em            INTEGER NOT NULL DEFAULT 0,
    falhas_consecutivas  INTEGER NOT NULL DEFAULT 0,
    last_ok_at           INTEGER NOT NULL DEFAULT 0,
    last_fail_at         INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS agendamentos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo       TEXT NOT NULL,
    valor      TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'text',
    conteudo   BLOB,
    caption    TEXT DEFAULT '',
    activo     INTEGER NOT NULL DEFAULT 1,
    ultimo_env INTEGER NOT NULL DEFAULT 0,
    criado_em  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS historico (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    agendamento_id   INTEGER,
    enviado_em       INTEGER NOT NULL,
    grupos_atingidos INTEGER NOT NULL DEFAULT 0,
    erros            INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clientes_divulgacao (
    numero         TEXT PRIMARY KEY,
    plano_key      TEXT    NOT NULL DEFAULT '',
    intervalo_min  INTEGER NOT NULL DEFAULT 60,
    media_type     TEXT    NOT NULL DEFAULT 'text',
    conteudo       BLOB,
    caption        TEXT    NOT NULL DEFAULT '',
    agendamento_id INTEGER,
    expira_em      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS lid_map (
    lid  TEXT PRIMARY KEY,
    num  TEXT NOT NULL
  );
`)

// Migrações — adiciona colunas novas sem quebrar bases de dados existentes
try { db.exec(`ALTER TABLE grupos ADD COLUMN falhas_consecutivas INTEGER NOT NULL DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE grupos ADD COLUMN last_ok_at INTEGER NOT NULL DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE grupos ADD COLUMN last_fail_at INTEGER NOT NULL DEFAULT 0`) } catch {}

const CONFIG_DEFAULTS = {
  autoentrar      : 'false',  // desligado — dono activa com !autoentrar on
  autosair        : 'false',  // desligado — dono activa com !autosair on
  limite_grupos   : '200',
  ia_activa       : 'false',  // desligado — dono activa com !ia on
  historico_activo: 'false',  // desligado — dono activa com !historico on
  grupos_todos    : 'false',
  pv_activo       : 'false',  // bot não responde a estranhos no PV por omissão
  pv_notificar    : 'false',  // sem notificações de PV por omissão
  aceitar_links   : 'true',   // links permitidos nas mensagens de divulgação por omissão
  max_por_envio   : '60',    // máximo de grupos por broadcast (anti-ban)
}
for (const [k, v] of Object.entries(CONFIG_DEFAULTS)) {
  db.prepare(`INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)`).run(k, v)
}

// Config helpers
export function getCfg(chave) {
  const row = db.prepare(`SELECT valor FROM config WHERE chave = ?`).get(chave)
  if (!row) return null
  try { return JSON.parse(row.valor) } catch { return row.valor }
}

export function setCfg(chave, valor) {
  db.prepare(`INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)`)
    .run(chave, JSON.stringify(valor))
}

export function getAllCfg() {
  const rows = db.prepare(`SELECT chave, valor FROM config`).all()
  const out  = {}
  for (const r of rows) {
    try { out[r.chave] = JSON.parse(r.valor) } catch { out[r.chave] = r.valor }
  }
  return out
}

// Grupos helpers
export function upsertGrupo(id, nome) {
  db.prepare(`
    INSERT INTO grupos (id, nome, activo, entrou_em)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET nome = excluded.nome
  `).run(id, nome, Date.now())
}

export function setGrupoActivo(id, activo) {
  db.prepare(`UPDATE grupos SET activo = ? WHERE id = ?`).run(activo ? 1 : 0, id)
}

export function getGruposActivos() {
  return db.prepare(`SELECT id, nome, falhas_consecutivas, last_ok_at, last_fail_at FROM grupos WHERE activo = 1`).all()
}

export function getAllGrupos() {
  return db.prepare(`SELECT id, nome, activo, falhas_consecutivas, last_ok_at FROM grupos ORDER BY nome`).all()
}

export function countGrupos() {
  return db.prepare(`SELECT COUNT(*) as n FROM grupos`).get().n
}

export function grupoExiste(id) {
  return !!db.prepare(`SELECT 1 FROM grupos WHERE id = ?`).get(id)
}

export function removerGrupo(id) {
  db.prepare(`DELETE FROM grupos WHERE id = ?`).run(id)
}

// ── Falhas consecutivas por grupo ──────────────────────────────────────
// Grupos que fecham à noite acumulam falhas mas resetam ao primeiro sucesso.
// Só são desactivados após FALHAS_MAX falhas seguidas (sem nenhum sucesso).
export const FALHAS_MAX = 5

export function incrementarFalhasGrupo(id) {
  const agora = Date.now()
  db.prepare(`UPDATE grupos SET falhas_consecutivas = falhas_consecutivas + 1, last_fail_at = ? WHERE id = ?`).run(agora, id)
  return db.prepare(`SELECT falhas_consecutivas FROM grupos WHERE id = ?`).get(id)?.falhas_consecutivas ?? 0
}

export function resetarFalhasGrupo(id) {
  db.prepare(`UPDATE grupos SET falhas_consecutivas = 0, last_ok_at = ? WHERE id = ?`).run(Date.now(), id)
}

export function getFalhasGrupo(id) {
  return db.prepare(`SELECT falhas_consecutivas FROM grupos WHERE id = ?`).get(id)?.falhas_consecutivas ?? 0
}

// Relatórios por número de cliente (liga historico ↔ clientes_divulgacao)
export function getRelatoriosCliente(numero, limit = 5) {
  return db.prepare(`
    SELECT h.enviado_em, h.grupos_atingidos, h.erros
    FROM historico h
    JOIN clientes_divulgacao cd ON cd.agendamento_id = h.agendamento_id
    WHERE cd.numero = ?
    ORDER BY h.enviado_em DESC
    LIMIT ?
  `).all(numero, limit)
}

// Agendamentos helpers
export function criarAgendamento({ tipo, valor, media_type, conteudo, caption }) {
  return db.prepare(`
    INSERT INTO agendamentos (tipo, valor, media_type, conteudo, caption, activo, criado_em)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(tipo, valor, media_type, conteudo, caption ?? '', Date.now()).lastInsertRowid
}

export function getAgendamentosActivos() {
  return db.prepare(`SELECT * FROM agendamentos WHERE activo = 1`).all()
}

export function pausarTodos() {
  db.prepare(`UPDATE agendamentos SET activo = 0`).run()
}

export function retomarTodos() {
  db.prepare(`UPDATE agendamentos SET activo = 1`).run()
}

export function cancelarAgendamento(id) {
  db.prepare(`DELETE FROM agendamentos WHERE id = ?`).run(id)
}

export function cancelarTodos() {
  db.prepare(`DELETE FROM agendamentos`).run()
}

export function updateUltimoEnvio(id) {
  db.prepare(`UPDATE agendamentos SET ultimo_env = ? WHERE id = ?`).run(Date.now(), id)
}

// Histórico helpers
export function registarHistorico({ agendamento_id, grupos_atingidos, erros }) {
  db.prepare(`
    INSERT INTO historico (agendamento_id, enviado_em, grupos_atingidos, erros)
    VALUES (?, ?, ?, ?)
  `).run(agendamento_id ?? null, Date.now(), grupos_atingidos, erros)
}

export function getHistorico(limit = 10) {
  return db.prepare(`
    SELECT * FROM historico ORDER BY enviado_em DESC LIMIT ?
  `).all(limit)
}

// ── Clientes divulgação ────────────────────────────────────────────────

export function upsertClienteDivulgacao({ numero, plano_key, intervalo_min, media_type, conteudo, caption, agendamento_id, expira_em }) {
  db.prepare(`
    INSERT OR REPLACE INTO clientes_divulgacao
      (numero, plano_key, intervalo_min, media_type, conteudo, caption, agendamento_id, expira_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(numero, plano_key, intervalo_min ?? 60, media_type ?? 'text',
         conteudo ?? null, caption ?? '', agendamento_id ?? null, expira_em)
}

export function getClienteDivulgacao(numero) {
  return db.prepare(`SELECT * FROM clientes_divulgacao WHERE numero = ?`).get(numero)
}

export function getClientesActivosDivulgacao() {
  return db.prepare(`SELECT * FROM clientes_divulgacao WHERE expira_em > ?`).all(Date.now())
}

// Actualiza apenas o conteúdo de um cliente (mantém expira_em e plano_key intactos)
export function atualizarConteudoCliente({ numero, media_type, conteudo, caption, agendamento_id }) {
  db.prepare(`
    UPDATE clientes_divulgacao
    SET media_type = ?, conteudo = ?, caption = ?, agendamento_id = ?
    WHERE numero = ?
  `).run(media_type ?? 'text', conteudo ?? null, caption ?? '', agendamento_id ?? null, numero)
}

export function removerClienteDivulgacao(numero) {
  const c = db.prepare(`SELECT agendamento_id FROM clientes_divulgacao WHERE numero = ?`).get(numero)
  if (c?.agendamento_id) db.prepare(`DELETE FROM agendamentos WHERE id = ?`).run(c.agendamento_id)
  db.prepare(`DELETE FROM clientes_divulgacao WHERE numero = ?`).run(numero)
}

// Remove subscrições expiradas e os respectivos agendamentos. Retorna n removidos.
export function limparClientesExpirados() {
  const expirados = db.prepare(
    `SELECT * FROM clientes_divulgacao WHERE expira_em > 0 AND expira_em <= ?`
  ).all(Date.now())
  for (const c of expirados) {
    if (c.agendamento_id)
      db.prepare(`DELETE FROM agendamentos WHERE id = ?`).run(c.agendamento_id)
  }
  if (expirados.length)
    db.prepare(`DELETE FROM clientes_divulgacao WHERE expira_em > 0 AND expira_em <= ?`).run(Date.now())
  return expirados.length
}

// ── LID ↔ número — WhatsApp privacy identifiers ───────────────────────
// Guarda o mapeamento lid → número de telefone na base de dados.
export function saveLid(lid, num) {
  if (!lid || !num) return
  db.prepare(`INSERT OR REPLACE INTO lid_map (lid, num) VALUES (?, ?)`).run(lid, num)
}

// Resolve um LID para número de telefone. Retorna null se desconhecido.
export function resolveLid(lid) {
  if (!lid) return null
  const row = db.prepare(`SELECT num FROM lid_map WHERE lid = ?`).get(lid)
  return row?.num ?? null
}
