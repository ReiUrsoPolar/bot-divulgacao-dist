#!/bin/bash

# ── Cores ──────────────────────────────────────────────────────────────
CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'

DIST_REPO="https://github.com/ReiUrsoPolar/bot-divulgacao-dist"
DIST_ZIP="${DIST_REPO}/archive/refs/heads/main.zip"
GITHUB_API="https://api.github.com/repos/ReiUrsoPolar/bot-divulgacao-dist/commits/main"

# ── Banner ─────────────────────────────────────────────────────────────
echo -e "${CYAN}"
echo "  ██████╗ ██╗██╗   ██╗██╗   ██╗██╗      ██████╗  █████╗  ██████╗  "
echo "  ██╔══██╗██║██║   ██║██║   ██║██║     ██╔════╝ ██╔══██╗██╔════╝  "
echo "  ██║  ██║██║██║   ██║██║   ██║██║     ██║  ███╗███████║██║       "
echo "  ██║  ██║██║╚██╗ ██╔╝██║   ██║██║     ██║   ██║██╔══██║██║       "
echo "  ██████╔╝██║ ╚████╔╝ ╚██████╔╝███████╗╚██████╔╝██║  ██║╚██████╗  "
echo "  ╚═════╝ ╚═╝  ╚═══╝   ╚═════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ "
echo -e "${NC}"

# ══════════════════════════════════════════════════════════════════════
# FASE 1 — AUTO-ACTUALIZAÇÃO
# ══════════════════════════════════════════════════════════════════════
atualizar() {
  echo -e "${CYAN}  🔄  A verificar actualizações...${NC}"

  # ── Modo Git (preferido) ────────────────────────────────────────────
  if command -v git &>/dev/null && [ -d ".git" ]; then

    # Garantir que origin aponta SEMPRE para o repo dist (código ofuscado)
    git remote set-url origin "$DIST_REPO" 2>/dev/null || true

    git fetch origin main --quiet 2>/dev/null
    LOCAL=$(git rev-parse HEAD 2>/dev/null)
    REMOTE=$(git rev-parse origin/main 2>/dev/null)

    if [ -z "$REMOTE" ]; then
      echo -e "${YELLOW}  ⚠  Sem ligação ao GitHub — a saltar actualização.${NC}"
      return
    fi

    if [ "$LOCAL" != "$REMOTE" ]; then
      SHORT=$(echo "$REMOTE" | cut -c1-7)
      echo -e "${YELLOW}  ↗  Nova versão detectada (${SHORT})! A actualizar...${NC}"
      git reset --hard origin/main --quiet
      echo -e "${GREEN}  ✓  Actualizado para ${SHORT}!${NC}"
    else
      SHORT=$(echo "$LOCAL" | cut -c1-7)
      echo -e "${GREEN}  ✓  Já na versão mais recente (${SHORT}).${NC}"
    fi

  # ── Modo Curl (fallback — sem git) ─────────────────────────────────
  elif command -v curl &>/dev/null; then

    echo -e "${YELLOW}  ↗  git não encontrado — a usar curl...${NC}"

    REMOTE_HASH=$(curl -sf "${GITHUB_API}" \
      | grep '"sha"' | head -1 \
      | sed 's/.*"sha": "\([^"]*\)".*/\1/' \
      | cut -c1-7)

    HASH_FILE=".version_hash"
    LOCAL_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

    if [ -z "$REMOTE_HASH" ]; then
      echo -e "${YELLOW}  ⚠  Sem ligação ao GitHub — a saltar actualização.${NC}"
      return
    fi

    if [ "$REMOTE_HASH" = "$LOCAL_HASH" ]; then
      echo -e "${GREEN}  ✓  Já na versão mais recente (${LOCAL_HASH}).${NC}"
      return
    fi

    echo -e "${YELLOW}  ↗  Nova versão (${REMOTE_HASH}) detectada! A descarregar...${NC}"

    # Guardar ficheiros do cliente antes de sobrescrever
    TMP_BOT_JSON=$(mktemp)
    TMP_AUTH_DIR=$(mktemp -d)
    [ -f "config/bot.json" ] && cp "config/bot.json" "$TMP_BOT_JSON"
    [ -d "auth_info_baileys" ] && cp -r "auth_info_baileys/." "$TMP_AUTH_DIR/"
    [ -d "database" ]          && cp -r "database" /tmp/bot_database_backup/

    # Descarregar e extrair
    curl -sL "$DIST_ZIP" -o /tmp/bot-update.zip
    rm -rf /tmp/bot-update-extract
    mkdir -p /tmp/bot-update-extract
    unzip -q /tmp/bot-update.zip -d /tmp/bot-update-extract/
    EXTRACTED=$(ls /tmp/bot-update-extract/ | head -1)

    # Copiar para o directório actual (preserva config/bot.json e auth)
    cp -r "/tmp/bot-update-extract/${EXTRACTED}/." ./

    # Restaurar ficheiros do cliente
    [ -s "$TMP_BOT_JSON" ]     && cp "$TMP_BOT_JSON" "config/bot.json"
    [ -n "$(ls -A "$TMP_AUTH_DIR" 2>/dev/null)" ] && cp -r "$TMP_AUTH_DIR/." "auth_info_baileys/"
    [ -d "/tmp/bot_database_backup" ] && cp -r "/tmp/bot_database_backup" ./database

    # Limpar temporários
    rm -rf /tmp/bot-update.zip /tmp/bot-update-extract \
           "$TMP_BOT_JSON" "$TMP_AUTH_DIR" /tmp/bot_database_backup

    echo "$REMOTE_HASH" > "$HASH_FILE"
    echo -e "${GREEN}  ✓  Actualizado para ${REMOTE_HASH}!${NC}"

  else
    echo -e "${YELLOW}  ⚠  git e curl não disponíveis — a saltar actualização.${NC}"
  fi
}

# ══════════════════════════════════════════════════════════════════════
# FASE 2 — DEPENDÊNCIAS
# ══════════════════════════════════════════════════════════════════════
_compilar_sqlite() {
  echo -e "${YELLOW}  ↓  A compilar better-sqlite3...${NC}"
  npm rebuild better-sqlite3 --no-fund 2>&1 | grep -v "^npm warn" || true
  echo -e "${GREEN}  ✓  better-sqlite3 compilado!${NC}"
}

verificar_deps() {
  NODE_VER=$(node -e "process.stdout.write(process.version)" 2>/dev/null)

  # ── Primeira instalação ─────────────────────────────────────────────
  if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  ↓  Primeira instalação (Node ${NODE_VER})...${NC}"
    npm install --no-fund --no-audit 2>&1 | grep -v "^npm warn"
    _compilar_sqlite
    return
  fi

  # ── package.json mudou? (MD5) ───────────────────────────────────────
  PKG_HASH=$(md5sum package.json 2>/dev/null | cut -d' ' -f1 \
          || md5 -q package.json 2>/dev/null || echo "")
  PKG_HASH_FILE=".pkg_hash"
  OLD_HASH=$(cat "$PKG_HASH_FILE" 2>/dev/null || echo "")

  if [ -n "$PKG_HASH" ] && [ "$PKG_HASH" != "$OLD_HASH" ]; then
    echo -e "${YELLOW}  ↗  Dependências actualizadas — a instalar...${NC}"
    npm install --no-fund --no-audit 2>&1 | grep -v "^npm warn"
    echo "$PKG_HASH" > "$PKG_HASH_FILE"
    _compilar_sqlite
    return
  fi

  # ── better-sqlite3 compilado para este Node? ────────────────────────
  # ATENÇÃO: require() sozinho não carrega o binário nativo — só new Database() o faz.
  # Por isso testamos com ':memory:' para garantir que o .node é compatível com este Node.
  SQLITE_OK=$(node -e \
    "try{const B=require('./node_modules/better-sqlite3');new B(':memory:');process.stdout.write('ok')}catch(e){process.stdout.write('no')}" \
    2>/dev/null)

  if [ "$SQLITE_OK" != "ok" ]; then
    echo -e "${YELLOW}  ↗  better-sqlite3 precisa de recompilação (Node ${NODE_VER})...${NC}"
    _compilar_sqlite
  else
    echo -e "${GREEN}  ✓  Dependências OK (Node ${NODE_VER})${NC}"
  fi
}

# ── Carrega .env se existir (cópia privada do criador) ────────────────
if [ -f .env ]; then
  NODE_ENV_FLAG="--env-file=.env"
else
  NODE_ENV_FLAG=""
fi

# ══════════════════════════════════════════════════════════════════════
# LOOP PRINCIPAL
# ══════════════════════════════════════════════════════════════════════
while true; do
  atualizar
  verificar_deps

  echo -e "\n${GREEN}  🚀  A iniciar Bot Divulgação...${NC}\n"

  # ── Garantir patches correctos do Baileys (am:lid + participantes @lid) ──
  node << 'PATCH_EOF'
const fs=require('fs');
const f='node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js';
try {
  let c=fs.readFileSync(f,'utf8');
  function fix(d,p,o){if(c.includes(o))return;if(!c.includes(p))return;c=c.replace(p,o);console.log('  [patch]',d);}
  // REVERT addressing_mode em PV -> volta ao vanilla (so GRUPOS), como o Polar.
  // addressing_mode:'lid' num PV dispara o erro 463 (reach-out timelock): o
  // servidor trata como "abordar desconhecido". Em PV NAO se marca lid.
  fix('am1-rev','if (isLid) { additionalAttributes = { ...(additionalAttributes || {}), addressing_mode: \'lid\' }; }',
                'if (isLid && isGroup) { additionalAttributes = { ...(additionalAttributes || {}), addressing_mode: \'lid\' }; }');
  fix('am2-rev','if(isLid){additionalAttributes={...(additionalAttributes||{}),addressing_mode:\'lid\'}}',
                'if(isLid && isGroup){additionalAttributes={...(additionalAttributes||{}),addressing_mode:\'lid\'}}');
  fix('am3-rev','if(isLid && !(additionalAttributes||{}).addressing_mode)',
                'if(isLid && isGroup && !(additionalAttributes||{}).addressing_mode)');
  fix('fr', 'await assertSessions(allJids, isLid);','await assertSessions(allJids, false);');
  fix('nsl','if (isMe && !isLid) {\n                        meJids.push(jid);\n                        allJids.push(jid);\n                    }\n                    else if (!isMe) {\n                        otherJids.push(jid);\n                        allJids.push(jid);\n                    }',
            'if (isMe) {\n                        meJids.push(jid);\n                    }\n                    else {\n                        otherJids.push(jid);\n                    }\n                    allJids.push(jid);');
  fs.writeFileSync(f,c,'utf8');
} catch(e){ console.error('  [patch error]',e.message); }
PATCH_EOF

  node $NODE_ENV_FLAG index.js
  EXIT_CODE=$?

  # !atualizar (código 42) → re-executar o start.sh do INÍCIO. Necessário para
  # reler o próprio start.sh (patches/am1-rev) e o código novo já feito git reset.
  if [ $EXIT_CODE -eq 42 ]; then
    echo -e "\n${CYAN}  🔄  Atualização pedida — a reiniciar por completo...${NC}\n"
    exec bash "$0"
  fi

  if [ $EXIT_CODE -eq 0 ]; then
    echo -e "\n${CYAN}  ✅  Bot encerrado normalmente.${NC}\n"
    break
  fi

  echo -e "\n${YELLOW}  ⚠  Bot encerrou com código ${EXIT_CODE}. A reiniciar em 5s...${NC}\n"
  sleep 5
done
