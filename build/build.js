#!/usr/bin/env node
// build/build.js — Obfusca o source e publica no repo dist
// Uso: node build/build.js [--push]
//   --push  faz git commit + push no repo dist automaticamente
//
// O repo dist deve estar clonado em ../bot-divulgacao-dist
// (ou definir DIST_PATH=<caminho> no ambiente)

import JavaScriptObfuscator from 'javascript-obfuscator'
import {
  readdirSync, statSync, readFileSync, writeFileSync,
  mkdirSync, rmSync, existsSync, copyFileSync,
} from 'fs'
import { join, dirname, relative, extname } from 'path'
import { fileURLToPath }  from 'url'
import { execSync }       from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')
const DIST_PATH = process.env.DIST_PATH
  ?? join(ROOT, '..', 'bot-divulgacao-dist')
const PUSH      = process.argv.includes('--push')

// ── Configuração do obfuscador ────────────────────────────────────────
const OBFUSCATOR_CONFIG = {
  compact                         : true,
  controlFlowFlattening           : true,
  controlFlowFlatteningThreshold  : 0.3,
  deadCodeInjection               : false,
  debugProtection                 : false,
  disableConsoleOutput            : false,
  identifierNamesGenerator        : 'hexadecimal',
  log                             : false,
  numbersToExpressions            : true,
  renameGlobals                   : false,   // manter imports/exports ESM intactos
  selfDefending                   : false,   // pode causar problemas em Node.js
  simplify                        : true,
  splitStrings                    : true,
  splitStringsChunkLength         : 8,
  stringArray                     : true,
  stringArrayCallsTransform       : true,
  stringArrayCallsTransformThreshold: 0.5,
  stringArrayEncoding             : ['base64'],
  stringArrayIndexShift           : true,
  stringArrayRotate               : true,
  stringArrayShuffle              : true,
  stringArrayWrappersCount        : 2,
  stringArrayWrappersChainedCalls : true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType         : 'function',
  stringArrayThreshold            : 0.75,
  unicodeEscapeSequence           : false,
  target                          : 'node',
  sourceMap                       : false,
}

// ── Ficheiros/pastas a copiar sem obfuscação ──────────────────────────
const COPY_FILES = [
  'package.json',
  'package-lock.json',
  'README.md',
  'start.sh',
  '.gitignore',
]

const COPY_DIRS = [
  'config',    // bot.exemplo.json, loja.json, msgs.json, configuracao.json
]

// ── Pastas de source JS a obfuscar ────────────────────────────────────
const SOURCE_JS_FILES = [
  'index.js',
]
const SOURCE_JS_DIRS = [
  'src',
]

// ── Helpers ───────────────────────────────────────────────────────────
function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, files)
    else files.push(full)
  }
  return files
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

function obfuscateFile(srcPath, dstPath) {
  const src  = readFileSync(srcPath, 'utf8')
  let   out
  try {
    out = JavaScriptObfuscator.obfuscate(src, OBFUSCATOR_CONFIG).getObfuscatedCode()
  } catch (e) {
    console.warn(`  ⚠ Obfuscação falhou para ${relative(ROOT, srcPath)}: ${e.message}`)
    console.warn(`    → A copiar sem obfuscação`)
    out = src
  }
  ensureDir(dirname(dstPath))
  writeFileSync(dstPath, out, 'utf8')
}

function copyDir(src, dst) {
  for (const f of walk(src)) {
    const rel     = relative(src, f)
    const dstFile = join(dst, rel)
    ensureDir(dirname(dstFile))
    copyFileSync(f, dstFile)
  }
}

// ── Main ──────────────────────────────────────────────────────────────
console.log('\n🔨 Build — Bot Divulgação Dist\n')

if (!existsSync(DIST_PATH)) {
  console.error(`❌ Repo dist não encontrado em: ${DIST_PATH}`)
  console.error(`   Clona primeiro: git clone https://github.com/ReiUrsoPolar/bot-divulgacao-dist "${DIST_PATH}"`)
  process.exit(1)
}

// 1. Limpar dist (preservar .git)
console.log('🗑  A limpar dist (preservando .git)...')
for (const name of readdirSync(DIST_PATH)) {
  if (name === '.git') continue
  const full = join(DIST_PATH, name)
  rmSync(full, { recursive: true, force: true })
}

// 2. Obfuscar ficheiros JS
console.log('🔒 A obfuscar ficheiros JS...')

// index.js e outros JS raiz
for (const f of SOURCE_JS_FILES) {
  const src = join(ROOT, f)
  if (!existsSync(src)) continue
  const dst = join(DIST_PATH, f)
  process.stdout.write(`  ${f} ... `)
  obfuscateFile(src, dst)
  console.log('✓')
}

// Pastas src/
for (const dir of SOURCE_JS_DIRS) {
  const srcDir = join(ROOT, dir)
  if (!existsSync(srcDir)) continue
  for (const f of walk(srcDir)) {
    if (extname(f) !== '.js') continue
    const rel = relative(ROOT, f)
    const dst = join(DIST_PATH, rel)
    process.stdout.write(`  ${rel} ... `)
    obfuscateFile(f, dst)
    console.log('✓')
  }
}

// 3. Copiar ficheiros sem obfuscação
console.log('📁 A copiar ficheiros estáticos...')

for (const f of COPY_FILES) {
  const src = join(ROOT, f)
  if (!existsSync(src)) continue
  const dst = join(DIST_PATH, f)
  copyFileSync(src, dst)
  console.log(`  ${f} ✓`)
}

for (const dir of COPY_DIRS) {
  const src = join(ROOT, dir)
  if (!existsSync(src)) continue
  const dst = join(DIST_PATH, dir)
  ensureDir(dst)
  // Copiar mas excluir bot.json (ficheiro privado do dono)
  for (const f of walk(src)) {
    if (f.endsWith('bot.json')) continue    // nunca incluir no dist
    const rel     = relative(src, f)
    const dstFile = join(dst, rel)
    ensureDir(dirname(dstFile))
    copyFileSync(f, dstFile)
    console.log(`  ${join(dir, rel)} ✓`)
  }
}

console.log('\n✅ Build concluído!')
console.log(`   Output: ${DIST_PATH}\n`)

// 4. Git push (opcional)
if (PUSH) {
  console.log('🚀 A fazer commit e push no repo dist...')
  try {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    const date    = new Date().toISOString().slice(0, 10)
    execSync('git add -A', { cwd: DIST_PATH, stdio: 'inherit' })
    execSync(
      `git commit -m "dist: build ${version} — ${date}"`,
      { cwd: DIST_PATH, stdio: 'inherit' }
    )
    execSync('git push', { cwd: DIST_PATH, stdio: 'inherit' })
    console.log('\n✅ Publicado no repo dist com sucesso!\n')
  } catch (e) {
    console.error('\n❌ Erro no git push:', e.message)
    process.exit(1)
  }
} else {
  console.log('💡 Para publicar automaticamente: node build/build.js --push\n')
}
