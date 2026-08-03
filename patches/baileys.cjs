// patches/baileys.cjs — Baileys patches applied automatically after npm install
// CommonJS (.cjs) so Node loads it as CJS regardless of package.json "type":"module".
'use strict';
const { readFileSync, writeFileSync } = require('fs');

const MSG_SEND = 'node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js';

function applyPatch(file, description, oldStr, newStr) {
  try {
    let c = readFileSync(file, 'utf8');
    if (c.includes(newStr)) {
      console.log('[patch] Already applied: ' + description);
      return;
    }
    if (!c.includes(oldStr)) {
      console.log('[patch] Pattern not found (version mismatch?): ' + description);
      return;
    }
    writeFileSync(file, c.replace(oldStr, newStr), 'utf8');
    console.log('[patch] Applied: ' + description);
  } catch (e) {
    console.log('[patch] Skip ' + description + ':', e.message);
  }
}

// ── Fix 1: Prevent crash when me.lid is null/undefined (Privacy Mode) ─────────
// This is the ONLY real bug fix needed. The rest is native LID handling.
applyPatch(MSG_SEND, 'me.lid?.split fix',
  'me?.lid.split(',
  'me?.lid?.split('
);

// ── Fix 2 REMOVIDO: addressing_mode:'lid' em PV causava o erro 463 ───────────
// Em PV o WhatsApp espera addressing_mode 'pn' (telefone), como faz o vanilla e
// o bot Polar. Marcar 'lid' num PV dispara o reach-out timelock (463). O grupo
// continua a usar 'lid' nativamente (groupData?.addressingMode). NÃO reintroduzir.
// (O start.sh ainda reverte, em cada arranque, qualquer bloco inserido por
//  versões antigas deste patch, repondo o comportamento por grupo.)

// ── REVERT experimental hacks (Fix 3 / Fix 4) ─────────────────────────────────
// These were attempts to fix error 479 by manipulating Signal sessions/devices.
// They fought Baileys' native LID + retry handling and did NOT work. We undo them
// here so that running this script self-heals an already-patched node_modules,
// restoring clean native Baileys 6.7.21 behaviour.

// Undo Fix 3 (pre-transaction @lid session deletion)
applyPatch(MSG_SEND, 'REVERT pre-tx @lid session delete',
  'if (isLid && !participant) { await authState.keys.set({ \'session\': { [signalRepository.jidToSignalProtocolAddress(destinationJid)]: null } }); }\n        await authState.keys.transaction(async () => {',
  'await authState.keys.transaction(async () => {'
);

// Undo Fix 4 (skip bare recipient @lid in participants)
applyPatch(MSG_SEND, 'REVERT skip bare @lid in participants',
  'if (!isLid) devices.push({ user }); // lid: bare JID has no device session',
  'devices.push({ user });'
);

// Undo old Fix 3 (assertSessions force=isLid) if a server applied it
applyPatch(MSG_SEND, 'REVERT assertSessions force=isLid',
  'await assertSessions(allJids, isLid); // fix-479: always pkmsg for @lid PV',
  'await assertSessions(allJids, false);'
);

// ── Limpeza do console: remover diagnósticos [ENC]/[FETCH]/[STANZA] ────────────
// Eram logs de debug usados para diagnosticar o erro 479 (já resolvido). Poluíam
// o console a cada mensagem. Removemos QUALQUER console.log('[ENC|FETCH|STANZA]...)
// que tenha ficado em node_modules patchados por versões antigas deste script.
(function removerDiagnosticos() {
  try {
    let c = readFileSync(MSG_SEND, 'utf8');
    const antes = c;
    c = c.replace(/\s*console\.log\('\[(?:ENC|FETCH|STANZA)\][^\n]*?\);/g, '');
    if (c !== antes) {
      writeFileSync(MSG_SEND, c, 'utf8');
      console.log('[patch] Removidos diagnosticos de console ([ENC]/[FETCH]/[STANZA])');
    } else {
      console.log('[patch] Console ja limpo (sem diagnosticos)');
    }
  } catch (e) {
    console.log('[patch] Skip remover diagnosticos:', e.message);
  }
})();
