#!/usr/bin/env node
// start.js — arrancar o bot em qualquer sistema.
//
// PORQUÊ ESTE FICHEIRO
//
// O `npm start` chamava `bash start.sh`. No Windows não há bash: quem comprava
// o bot descarregava o zip, escrevia `npm start` e não acontecia nada. Ficava
// com um produto pago que não arranca e sem forma de perceber porquê.
//
// Isto faz o mesmo que o start.sh — actualizar, instalar dependências, aplicar
// o patch do Baileys e manter o bot de pé — mas só com o Node, que já é preciso
// de qualquer maneira. O start.sh fica para quem já o usa (painéis, systemd).
//
//   node start.js        ← Windows, Linux, macOS, Termux
//
// Nunca toca no config, na sessão do WhatsApp nem na base de dados.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const DIST_REPO   = 'ReiUrsoPolar/bot-divulgacao-dist'
const DIST_BRANCH = 'main'

const C = {
  ciano: '\x1b[1;36m', verde: '\x1b[1;32m', amarelo: '\x1b[1;33m',
  vermelho: '\x1b[1;31m', cinza: '\x1b[0;90m', fim: '\x1b[0m',
}
const log  = (cor, txt) => console.log(`${cor}${txt}${C.fim}`)

const EH_TERMUX = !!process.env.TERMUX_VERSION || existsSync('/data/data/com.termux')

// O que é do cliente e NUNCA é substituído por uma actualização. Um update que
// apague isto custa-lhe a sessão do WhatsApp e a configuração toda.
const INTOCAVEIS = new Set([
  'node_modules', 'database', 'session', 'auth_info_baileys', '.tmp', '.git',
])
const CONFIG_INTOCAVEL = new Set([
  'bot.json', 'configuracao.json', 'loja.json', 'msgs.json', 'menus', 'anuncios.json',
])

function correr(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', ...opts })
}
function saida(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return r.status === 0 ? String(r.stdout ?? '').trim() : null
}
function temComando(cmd) {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' })
  // Só o ENOENT diz "não existe". Ir pelo código de saída dava falsos negativos
  // — o ffmpeg, por exemplo, não conhece o --version e sai com erro na mesma.
  return !r.error
}
// O npm e o npx são ficheiros .cmd no Windows, e o Node só os corre através da
// shell. Passar a linha inteira (em vez de comando + lista de argumentos) evita
// o aviso DEP0190 do Node, que aparecia no ecrã do cliente a cada arranque.
function correrShell(linha, opts = {}) {
  return spawnSync(linha, { stdio: 'inherit', shell: true, ...opts })
}

function banner() {
  log(C.ciano, `
  ██████╗ ██╗██╗   ██╗██╗   ██╗██╗      ██████╗  █████╗  ██████╗
  ██╔══██╗██║██║   ██║██║   ██║██║     ██╔════╝ ██╔══██╗██╔════╝
  ██║  ██║██║██║   ██║██║   ██║██║     ██║  ███╗███████║██║
  ██║  ██║██║╚██╗ ██╔╝██║   ██║██║     ██║   ██║██╔══██║██║
  ██████╔╝██║ ╚████╔╝ ╚██████╔╝███████╗╚██████╔╝██║  ██║╚██████╗
  ╚═════╝ ╚═╝  ╚═══╝   ╚═════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝`)
  console.log(`${C.cinza}  ${process.platform} · Node ${process.version}${EH_TERMUX ? ' · Termux' : ''}${C.fim}\n`)
}

// ── Actualizar ────────────────────────────────────────────────────────
// Com git é limpo e rápido. Sem git (o caso normal de quem só descompactou o
// zip) descarrega-se o tar.gz e copia-se por cima, saltando o que é do cliente.
function autoAtualizar() {
  log(C.amarelo, '  ↻  A verificar atualizações...')
  const url = `https://github.com/${DIST_REPO}.git`

  if (existsSync('.git') && temComando('git')) {
    const remoto = saida('git', ['remote', 'get-url', 'origin'])
    if (remoto !== url) {
      correr('git', ['remote', 'set-url', 'origin', url], { stdio: 'ignore' })
      log(C.amarelo, '  ↻  Remote corrigido para o repositório público.')
    }
    const antes = saida('git', ['rev-parse', 'HEAD'])
    correr('git', ['fetch', '--quiet', 'origin', DIST_BRANCH], { stdio: 'ignore' })
    const depois = saida('git', ['rev-parse', `origin/${DIST_BRANCH}`])
    if (!depois) { log(C.vermelho, '  ✗  Não consegui contactar o GitHub (sem rede?).'); return false }
    if (antes === depois) { log(C.verde, `  ✓  Já estás na versão mais recente. (${depois.slice(0, 7)})`); return false }
    // reset --hard e não pull: o dist tem histórico próprio (force push).
    correr('git', ['reset', '--hard', `origin/${DIST_BRANCH}`], { stdio: 'ignore' })
    log(C.verde, `  ✓  Atualizado! (${String(antes).slice(0, 7)} → ${depois.slice(0, 7)})`)
    return true
  }
  return atualizarPorDownload()
}

function atualizarPorDownload() {
  // O tar existe no Windows 10+, no Linux e no Termux. O unzip não — por isso
  // usa-se o tar.gz e não o zip.
  if (!temComando('tar')) {
    log(C.amarelo, '  ⚠  Sem git nem tar — não dá para atualizar sozinho.')
    log(C.cinza,   '     O bot arranca na mesma. Para atualizar, descarrega o zip novo do site.')
    return false
  }
  const base = join(tmpdir(), `div-upd-${process.pid}`)
  const tgz  = join(base, 'pacote.tar.gz')
  try {
    mkdirSync(base, { recursive: true })
    log(C.amarelo, '  ↓  A descarregar a versão mais recente...')
    const r = spawnSync('curl', ['-sL', '--max-time', '90', '-o', tgz,
      `https://codeload.github.com/${DIST_REPO}/tar.gz/refs/heads/${DIST_BRANCH}`])
    if (r.status !== 0 || !existsSync(tgz)) throw new Error('descarga falhou')

    // Nome RELATIVO e cwd, nunca "C:\...": no Windows com o Git instalado o
    // `tar` que está no PATH é o do MSYS, que lê "C:\pasta" como um servidor
    // remoto ("Cannot connect to C:") e falha sempre. Sem caminho absoluto,
    // funciona tanto com esse como com o tar da Microsoft.
    const t = spawnSync('tar', ['-xzf', 'pacote.tar.gz'], { cwd: base, encoding: 'utf8' })
    if (t.status !== 0) {
      throw new Error(String(t.stderr ?? '').split('\n')[0] || 'não consegui abrir o ficheiro')
    }
    // O tar.gz do GitHub traz tudo dentro de uma pasta "<repo>-<branch>".
    const dentro = readdirSync(base).map(n => join(base, n)).filter(p => statSync(p).isDirectory())[0]
    if (!dentro) throw new Error('arquivo vazio')

    copiarPorCima(dentro, process.cwd())
    log(C.verde, '  ✓  Atualizado!')
    return true
  } catch (e) {
    log(C.vermelho, `  ✗  Não consegui atualizar (${e.message}). O bot arranca na versão actual.`)
    return false
  } finally {
    try { rmSync(base, { recursive: true, force: true }) } catch {}   // leva o tgz dentro
  }
}

/** Copia a versão nova por cima, deixando intacto tudo o que é do cliente. */
export function copiarPorCima(origem, destino) {
  for (const nome of readdirSync(origem)) {
    if (INTOCAVEIS.has(nome)) continue
    const de = join(origem, nome), para = join(destino, nome)

    if (nome === 'config') {
      // A pasta config tem ficheiros nossos (defaults) e ficheiros DELE.
      mkdirSync(para, { recursive: true })
      for (const cf of readdirSync(de)) {
        if (CONFIG_INTOCAVEL.has(cf)) continue
        cpSync(join(de, cf), join(para, cf), { recursive: true, force: true })
      }
      continue
    }
    // force+recursive resolve também o caso de o destino ter o tipo trocado
    // (pasta onde devia estar ficheiro), que rebentava a cópia.
    try { rmSync(para, { recursive: true, force: true }) } catch {}
    cpSync(de, para, { recursive: true, force: true })
  }
}

// ── Dependências ──────────────────────────────────────────────────────
// Só o hash das DEPENDÊNCIAS, não do package.json inteiro: uma actualização
// que mude apenas scripts ou versão não obriga a reinstalar tudo.
function hashDeps() {
  try {
    const p = JSON.parse(readFileSync('package.json', 'utf8'))
    return createHash('md5').update(JSON.stringify([p.dependencies ?? {}, p.optionalDependencies ?? {}])).digest('hex')
  } catch { return '' }
}
function sqliteFunciona() {
  const r = spawnSync(process.execPath,
    ['-e', "new (require('./node_modules/better-sqlite3'))(':memory:').close()"], { encoding: 'utf8' })
  return r.status === 0
}
function instalarDeps() {
  log(C.amarelo, '  ↓  A instalar/atualizar dependências...')
  // --ignore-scripts: dentro de painéis com sandbox, compilar módulos nativos
  // rebenta ("Bad system call"). O binário do sqlite vem pronto logo a seguir.
  correrShell('npm install --ignore-scripts --no-fund --no-audit --prefer-offline')
  binarioSqlite()
  log(C.verde, '  ✓  Dependências prontas!\n')
}
function binarioSqlite() {
  if (!existsSync(join('node_modules', 'better-sqlite3'))) return true
  if (sqliteFunciona()) return true
  log(C.amarelo, `  ↓  A obter o binário do better-sqlite3 para o Node ${process.version}...`)
  correrShell('npx --yes prebuild-install@7 -r node --tag-prefix v',
    { cwd: join('node_modules', 'better-sqlite3'), stdio: 'ignore' })
  if (sqliteFunciona()) { log(C.verde, '  ✓  Binário pronto — sem recompilação.'); return true }
  return false
}
function verificarDeps() {
  const marca = join('node_modules', '.pkg_hash')
  if (!existsSync('node_modules')) {
    log(C.amarelo, '  ↗  Primeira instalação — isto pode demorar alguns minutos.\n')
    instalarDeps()
    try { writeFileSync(marca, hashDeps()) } catch {}
    return
  }
  const agora = hashDeps()
  let antes = ''
  try { antes = readFileSync(marca, 'utf8').trim() } catch {}
  if (agora && agora !== antes) {
    log(C.amarelo, '  ↗  Dependências alteradas — a sincronizar...')
    instalarDeps()
    try { writeFileSync(marca, agora) } catch {}
    return
  }
  if (!sqliteFunciona() && !binarioSqlite()) {
    if (EH_TERMUX) {
      log(C.amarelo, '  ⚠  O better-sqlite3 não compila no Termux — é normal.')
      log(C.ciano,   '     O bot usa o SQLite embutido no Node. A continuar...\n')
      return
    }
    // Num painel, quem recompila fora do sandbox é o painel: sai com 7, que é
    // o código que ele conhece.
    log(C.amarelo, '  ↗  O better-sqlite3 precisa de recompilação — a deixar o painel tratar disso...')
    process.exit(7)
  }
  log(C.verde, `  ✓  Dependências OK (Node ${process.version})\n`)
}

/** Espera sem gastar CPU e sem depender de nada instalado. */
function dormir(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${Math.max(0, ms | 0)})`])
}

/**
 * No Termux faltam programas do sistema que o bot usa. Sem o git, a actualização automática cai para a descarga do arquivo — que
 * também precisa de programas que podem não estar lá.
 */
function prepararTermux() {
  if (!EH_TERMUX) return
  const falta = ['git'].filter(c => !temComando(c))
  if (!falta.length) return
  log(C.amarelo, `  ↓  A instalar ${falta.join(' e ')} (só na primeira vez)...`)
  correrShell('pkg update -y', { stdio: 'ignore' })
  correrShell(`pkg install -y ${falta.join(' ')}`)
}

function aplicarPatches() {
  const p = join('patches', 'baileys.cjs')
  if (existsSync(p)) spawnSync(process.execPath, [p], { stdio: 'ignore' })
}

// ── Arranque ──────────────────────────────────────────────────────────
function principal() {
  banner()
  if (!existsSync('index.js')) {
    log(C.vermelho, '  ✗  Não encontro o index.js.')
    log(C.cinza,    '     Corre este comando DENTRO da pasta do bot (a que tem o index.js).')
    process.exit(1)
  }
  prepararTermux()
  autoAtualizar()
  verificarDeps()
  aplicarPatches()

  let seguidas = 0
  for (;;) {
    const inicio = Date.now()
    const r = spawnSync(process.execPath, ['index.js'], { stdio: 'inherit' })
    // Ctrl+C é uma ordem de quem está a ver: não se reinicia por cima dela.
    if (r.signal === 'SIGINT' || r.signal === 'SIGTERM') { console.log('\n  Até já.'); process.exit(0) }

    // Um bot que morre nos primeiros segundos não vai melhorar se lhe voltarmos
    // a pegar 2 segundos depois: é licença, config ou rede. Sem esta travagem,
    // o start.sh ficava a reinstalar e a descarregar do GitHub de 2 em 2
    // segundos, para sempre, com a mensagem do erro a passar rápido demais
    // para se ler.
    const durou = Date.now() - inicio
    seguidas = durou < 15_000 ? seguidas + 1 : 0
    const espera = seguidas ? Math.min(60, 2 ** seguidas) : 2

    log(C.amarelo, `\n  ⚠  Bot encerrado (código ${r.status ?? r.signal}).`)
    if (seguidas >= 3) {
      log(C.vermelho, `  ✗  Já falhou ${seguidas} vezes logo no arranque.`)
      log(C.cinza,    '     Lê a mensagem aqui em cima — costuma ser a licença ou o número do dono.')
    }
    log(C.amarelo, `  ↻  A tentar de novo daqui a ${espera}s...\n`)

    autoAtualizar()
    verificarDeps()
    aplicarPatches()
    dormir(espera * 1000)
  }
}

// Só arranca quando é ESTE o ficheiro corrido. Assim os testes podem importar a
// cópia — a parte que mexe nos ficheiros do cliente — sem levantar um bot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal()
