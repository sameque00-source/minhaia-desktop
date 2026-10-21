'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chat = require('./store');

const file = () => path.join(chat.chatsDir(), 'sessions.json');
function read() {
  try { const data = JSON.parse(fs.readFileSync(file(), 'utf8')); return Array.isArray(data) ? data : []; }
  catch { return []; }
}
function write(rows) {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, target);
}
function list(projectId) {
  const sessions = read().filter((s) => s.projectId === projectId);
  const legacy = chat.list(projectId);
  if (legacy.length) sessions.push({ id: null, projectId, title: 'Histórico anterior', createdAt: legacy[0].ts, updatedAt: legacy.at(-1).ts, legacy: true });
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function get(projectId, id) {
  if (id === null || id === undefined || id === '') return { id: null, projectId, title: 'Histórico anterior', legacy: true };
  if (!chat.SESSION_ID_RE.test(String(id))) return null;
  return read().find((s) => s.id === id && s.projectId === projectId) || null;
}
function create(projectId, title = 'Nova conversa') {
  const rows = read();
  const now = new Date().toISOString();
  const session = { id: `ses_${crypto.randomBytes(6).toString('hex')}`, projectId, title: String(title).slice(0, 120), createdAt: now, updatedAt: now };
  rows.push(session);
  write(rows);
  return session;
}
function touch(projectId, id, title) {
  if (!id) return;
  const rows = read();
  const item = rows.find((s) => s.id === id && s.projectId === projectId);
  if (!item) return;
  item.updatedAt = new Date().toISOString();
  if (title && item.title === 'Nova conversa') item.title = String(title).replace(/\s+/g, ' ').slice(0, 80);
  write(rows);
}

module.exports = { list, get, create, touch };
