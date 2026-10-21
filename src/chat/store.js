const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { paths } = require('../config');
const { redact } = require('../security/redact');

// Conversa por projeto: o histórico que dá contexto às missões seguintes ("chat persistente").
// É um arquivo .jsonl por projeto em data/chat/<projectId>.jsonl — append-only, texto redigido
// antes de gravar (nada de segredo em disco). A cada pedido do usuário a MinhaIA cria uma missão
// vinculada ao projeto; o histórico recente vira preâmbulo do objetivo (contexto real no prompt).

const PROJECT_ID_RE = /^prj_[a-z0-9]{12}$/;
const SESSION_ID_RE = /^ses_[a-z0-9]{12}$/;
const MAX_TEXT = 8000;
const MAX_TURNS_PREAMBLE = 6;
const MAX_CHARS_PREAMBLE = 1800;
const MAX_TURN_CHARS = 400;

function chatsDir() {
  return process.env.MINHAIA_CHATS_DIR ? path.resolve(process.env.MINHAIA_CHATS_DIR) : path.join(paths.DATA_DIR, 'chat');
}

function fileFor(projectId, sessionId = null) {
  if (typeof projectId !== 'string' || !PROJECT_ID_RE.test(projectId)) throw new Error(`id de projeto inválido: ${projectId}`);
  if (sessionId !== null && (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId))) throw new Error('id de sessão inválido');
  return path.join(chatsDir(), sessionId ? `${projectId}.${sessionId}.jsonl` : `${projectId}.jsonl`);
}

function append(projectId, { role, text, missionId = null, sessionId = null }) {
  const cleanRole = role === 'assistant' ? 'assistant' : 'user';
  const cleanText = redact(String(text || '').slice(0, MAX_TEXT));
  if (!cleanText.trim()) throw Object.assign(new Error('mensagem vazia'), { status: 400 });
  const msg = {
    id: `msg_${crypto.randomBytes(6).toString('hex')}`,
    role: cleanRole,
    text: cleanText,
    missionId: missionId || null,
    ts: new Date().toISOString(),
  };
  const file = fileFor(projectId, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(msg)}\n`);
  return msg;
}

function list(projectId, { limit = 500, sessionId = null } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(fileFor(projectId, sessionId), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* linha corrompida: ignora */ }
  }
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? out.slice(-n) : out;
}

/**
 * Preâmbulo com as últimas trocas da conversa do projeto, para o objetivo da missão seguinte.
 * Trunca por troca e por total; nunca inclui a mensagem atual (ela vem depois no objetivo).
 */
function contextPreamble(projectId, { maxTurns = MAX_TURNS_PREAMBLE, maxChars = MAX_CHARS_PREAMBLE, sessionId = null } = {}) {
  const msgs = list(projectId, { sessionId }).slice(-maxTurns);
  if (!msgs.length) return '';
  const lines = ['Contexto da conversa anterior neste projeto (use quando for relevante; não repita perguntas já respondidas):'];
  let used = lines[0].length;
  for (const m of msgs) {
    const who = m.role === 'user' ? 'Usuário' : 'MinhaIA';
    const text = m.text.length > MAX_TURN_CHARS ? `${m.text.slice(0, MAX_TURN_CHARS)}…` : m.text;
    const line = `${who}: ${text}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

module.exports = { append, list, contextPreamble, chatsDir, fileFor, PROJECT_ID_RE, SESSION_ID_RE };
