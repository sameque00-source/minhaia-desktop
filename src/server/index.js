const fs = require('fs');
const http = require('http');
const path = require('path');
const { paths } = require('../config');
const { MissionManager } = require('../missions/manager');
const views = require('../missions/views');
const store = require('../missions/store');
const projects = require('../projects/store');
const browse = require('../projects/browse');
const chat = require('../chat/store');
const chatSessions = require('../chat/sessions');
const { resumoDaMissao, reconcile } = require('../chat/reconcile');
const registry = require('../registry');
const { select } = require('../selection/selector');
const { providerStatus } = require('../engine');
const { verify } = require('../master/verify');
const { ensureRuntimeLinks } = require('../master/sync');
const modelCatalog = require('../models/catalog');

const UI_DIR = path.join(paths.ROOT, 'ui');
const MAX_BODY = 16 * 1024;
const MAX_SSE = 50;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // descarta o excesso para conseguir responder 413; corta só se passar de 1 MB
        if (size > 1024 * 1024) req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return reject(httpError(413, 'corpo da requisição acima de 16 KB'));
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

/** Só aceita a própria máquina: Host de loopback (anti DNS rebinding) e, em escrita, Origin igual. */
function checkRequest(req) {
  if (!LOOPBACK_HOST.test(String(req.headers.host || ''))) throw httpError(403, 'Host não permitido');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) throw httpError(403, 'Origin não permitida');
    if (!/^application\/json\b/.test(String(req.headers['content-type'] || ''))) throw httpError(415, 'Content-Type deve ser application/json');
  }
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const file = path.resolve(UI_DIR, rel);
  if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
  return true;
}

function createServer({ manager = new MissionManager() } = {}) {
  ensureRuntimeLinks(); // pacote desktop: links de runtime ausentes são recriados para o data/ do app
  const sseClients = new Set();

  function openSSE(req, res) {
    if (sseClients.size >= MAX_SSE) throw httpError(503, 'limite de conexões de streaming atingido');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...SECURITY_HEADERS });
    res.write('retry: 3000\n\n');
    const client = { res, filter: null };
    sseClients.add(client);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(client); });
    return client;
  }

  const unsubscribe = manager.subscribe((jobId, event) => {
    const frame = `id: ${event.seq}\nevent: mission\ndata: ${JSON.stringify(event)}\n\n`;
    for (const c of sseClients) if (!c.filter || c.filter === jobId) c.res.write(frame);
  });

  const unsubscribeChat = manager.subscribe((jobId, event) => {
    if (event.type !== 'finished') return;
    try {
      const job = store.get(jobId);
      if (!job || !job.chatMessageId || !job.projectId) return;
      const text = resumoDaMissao(job);
      if (text) {
        chat.append(job.projectId, { role: 'assistant', text, missionId: jobId, sessionId: job.chatSessionId || null });
        chatSessions.touch(job.projectId, job.chatSessionId || null);
      }
    } catch (e) {
      process.stderr.write(`[minhaia api] chat: ${e.message}\n`);
    }
  });

  function runningSummary() {
    return [...manager.running.keys()].map((id) => {
      const d = views.detail(id);
      const t = d && d.mission ? (d.mission.subtarefas || []).find((x) => x.status === 'em_progresso') : null;
      return { id, phase: d && (d.mission ? d.mission.estado : d.phase), task: t ? { id: t.id, descricao: t.descricao, agente: t.agente, skills: t.skills } : null };
    });
  }

  function reqProject(id) {
    const p = projects.get(id);
    if (!p) throw httpError(404, 'projeto não encontrado');
    return p;
  }

  /** @type {Array<[string, RegExp, (req: any, url: URL, res: any, params: string[]) => any, boolean?]>} */
  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],
    ['GET', /^\/api\/system$/, () => {
      const v = verify();
      const p = providerStatus();
      return {
        master: { ok: v.ok, problems: v.problems, head: v.masterHead, files: v.files, limited: !!v.limited },
        agents: registry.loadAgents().length,
        skills: registry.loadSkills().length,
        rules: registry.loadRules().map((r) => r.id),
        providers: { configured: p.configured, missing: p.missing, envFile: paths.SECRETS_ENV },
        missionsBlocked: p.configured.length === 0,
        limits: { maxConcurrent: manager.maxConcurrent, timeoutMs: manager.timeoutMs },
      };
    }],
    ['GET', /^\/api\/agents$/, () => registry.loadAgents()],
    ['GET', /^\/api\/skills$/, (_, url) => {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      return registry.loadSkills().filter((s) => !q || `${s.id} ${s.description}`.toLowerCase().includes(q)).map(({ file: _file, ...s }) => s);
    }],
    ['GET', /^\/api\/rules$/, () => registry.loadRules()],
    ['GET', /^\/api\/models$/, () => modelCatalog.list()],
    ['GET', /^\/api\/metrics$/, (_, url) => {
      const period = url.searchParams.get('period') || '30d';
      const days = period === '7d' ? 7 : period === '90d' ? 90 : period === 'all' ? null : 30;
      const since = days === null ? 0 : Date.now() - days * 86400000;
      const jobs = store.list().filter((j) => Date.parse(j.createdAt) >= since);
      const conversations = projects.list().flatMap((p) => chatSessions.list(p.id).map((session) => ({ ...session, messages: chat.list(p.id, { sessionId: session.id }) })));
      const activeConversations = conversations.filter((s) => Date.parse(s.createdAt) >= since);
      const activity = new Map(); const modelCounts = new Map();
      for (const job of jobs) {
        activity.set(job.createdAt.slice(0, 10), (activity.get(job.createdAt.slice(0, 10)) || 0) + 1);
      }
      for (const job of store.list()) for (const event of store.readEvents(job.id, { types: ['llm.end'] })) {
        if (Date.parse(event.ts || job.createdAt) >= since && event.model) modelCounts.set(event.model, (modelCounts.get(event.model) || 0) + 1);
      }
      const messages = conversations.flatMap((s) => s.messages).filter((m) => Date.parse(m.ts) >= since).length;
      const countDays = days || 90;
      const grid = Array.from({ length: countDays }, (_, i) => {
        const d = new Date(Date.now() - (countDays - i - 1) * 86400000).toISOString().slice(0, 10);
        return { date: d, count: activity.get(d) || 0 };
      });
      const sessionHours = new Map();
      for (const s of activeConversations) { const h = new Date(s.createdAt).getHours(); sessionHours.set(h, (sessionHours.get(h) || 0) + 1); }
      return { period, sessions: activeConversations.length, messages, tokens: null, activeDays: [...activity.values()].filter((n) => n > 0).length,
        peakHour: sessionHours.size ? [...sessionHours].sort((a, b) => b[1] - a[1])[0][0] : null,
        topModel: modelCounts.size ? [...modelCounts].sort((a, b) => b[1] - a[1])[0][0] : null,
        models: [...modelCounts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count), activity: grid };
    }],
    ['POST', /^\/api\/select$/, async (req) => {
      const body = await readBody(req);
      if (typeof body.task !== 'string' || !body.task.trim()) throw httpError(400, 'campo "task" obrigatório');
      return select(body.task.slice(0, 4000));
    }],
    // ---------------------------------------------------------------- projetos do usuário
    ['GET', /^\/api\/projects$/, () => projects.list().map((p) => ({ ...p, available: fs.existsSync(p.path) }))],
    ['POST', /^\/api\/projects$/, async (req, _url, res) => {
      const body = await readBody(req);
      const { project, created } = projects.add(body.path);
      res.statusCode = created ? 201 : 200;
      return { ...project, available: true, created };
    }],
    ['PUT', /^\/api\/projects\/([^/]+)$/, (_, __, ___, [id]) => {
      const p = projects.get(id);
      if (!p) throw httpError(404, 'projeto não encontrado');
      return { ...projects.touch(id), available: fs.existsSync(p.path) };
    }, true],
    ['DELETE', /^\/api\/projects\/([^/]+)$/, (_, __, ___, [id]) => {
      const r = projects.remove(id);
      if (!r.removed) throw httpError(404, r.reason);
      return { ok: true };
    }, true],
    ['GET', /^\/api\/projects\/([^/]+)$/, (_, __, ___, [id]) => {
      const p = projects.get(id);
      if (!p) throw httpError(404, 'projeto não encontrado');
      return { ...p, available: fs.existsSync(p.path) };
    }, true],
    ['GET', /^\/api\/projects\/([^/]+)\/files$/, (_, url, ___, [id]) => browse.listDir(reqProject(id), url.searchParams.get('path') || ''), true],
    ['GET', /^\/api\/projects\/([^/]+)\/file$/, (_, url, ___, [id]) => browse.readFile(reqProject(id), url.searchParams.get('path')), true],
    ['GET', /^\/api\/projects\/([^/]+)\/search$/, (_, url, ___, [id]) => browse.searchNames(reqProject(id), url.searchParams.get('q')), true],
    ['GET', /^\/api\/projects\/([^/]+)\/sessions$/, (_, __, ___, [id]) => chatSessions.list(reqProject(id).id), true],
    ['POST', /^\/api\/projects\/([^/]+)\/sessions$/, async (req, _url, res, [id]) => {
      const project = reqProject(id); const body = await readBody(req);
      res.statusCode = 201; return chatSessions.create(project.id, body.title || 'Nova conversa');
    }, true],
    ['GET', /^\/api\/projects\/([^/]+)\/chat$/, (_, url, ___, [id]) => {
      const project = reqProject(id);
      const sessionId = url.searchParams.get('sessionId') || null;
      if (!chatSessions.get(project.id, sessionId)) throw httpError(404, 'sessão não encontrada neste projeto');
      reconcile(project.id, sessionId); // pedidos terminados sem resposta (ex.: servidor reiniciado) são fechados aqui
      const n = Number(url.searchParams.get('limit')) || 200;
      return { messages: chat.list(project.id, { limit: Math.min(Math.max(n, 1), 1000), sessionId }) };
    }, true],
    // pedido do chat do projeto: histórico recente vira preâmbulo do objetivo (o motor vê o
    // contexto real da conversa) e a missão roda com o workspace na pasta do projeto
    ['POST', /^\/api\/projects\/([^/]+)\/chat$/, async (req, _url, res, [id]) => {
      const project = reqProject(id);
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      const sessionId = body.sessionId || null;
      const model = body.modelId ? modelCatalog.requireAvailable(body.modelId) : null;
      if (!chatSessions.get(project.id, sessionId)) throw httpError(404, 'sessão não encontrada neste projeto');
      if (!text) throw httpError(400, 'campo "text" obrigatório');
      if (text.length > 4000) throw httpError(400, 'texto acima de 4000 caracteres');
      const preamble = chat.contextPreamble(project.id, { sessionId });
      const objective = [preamble, `Pedido atual: ${text}`].filter(Boolean).join('\n\n').slice(0, 4000);
      const job = manager.create(objective, { projectId: project.id, modelId: model ? model.id : null });
      const message = chat.append(project.id, { role: 'user', text, missionId: job.id, sessionId });
      store.update(job.id, { chatMessageId: message.id, chatSessionId: sessionId });
      chatSessions.touch(project.id, sessionId, text);
      res.statusCode = 201;
      return { message, job: store.get(job.id) };
    }, true],
    ['GET', /^\/api\/missions$/, () => store.list()],
    ['POST', /^\/api\/missions$/, async (req, _url, res) => {
      const body = await readBody(req);
      const model = body.modelId ? modelCatalog.requireAvailable(body.modelId) : null;
      const job = manager.create(body.objective, { start: body.start !== false, projectId: body.projectId || null, modelId: model ? model.id : null });
      res.statusCode = 201;
      return job;
    }],
    ['POST', /^\/api\/missions\/([^/]+)\/start$/, (_, __, ___, [id]) => manager.start(id)],
    ['POST', /^\/api\/missions\/([^/]+)\/resume$/, (_, __, ___, [id]) => manager.start(id, { resume: true })],
    ['POST', /^\/api\/missions\/([^/]+)\/cancel$/, (_, __, ___, [id]) => manager.cancel(id)],
    ['GET', /^\/api\/missions\/([^/]+)$/, (_, __, ___, [id]) => views.detail(id)],
    ['GET', /^\/api\/missions\/([^/]+)\/tasks$/, (_, __, ___, [id]) => views.tasks(id)],
    ['GET', /^\/api\/missions\/([^/]+)\/agents$/, (_, __, ___, [id]) => views.agents(id)],
    ['GET', /^\/api\/missions\/([^/]+)\/skills$/, (_, __, ___, [id]) => views.skills(id)],
    ['GET', /^\/api\/missions\/([^/]+)\/execution$/, (_, url, ___, [id]) => views.execution(id, Number(url.searchParams.get('after') || 0))],
    ['GET', /^\/api\/missions\/([^/]+)\/logs$/, (_, url, ___, [id]) => views.logs(id, { afterSeq: Number(url.searchParams.get('after') || 0), types: url.searchParams.get('types') ? url.searchParams.get('types').split(',') : null, limit: Math.min(Math.max(Number(url.searchParams.get('limit')) || 5000, 1), 20000) })],
    ['GET', /^\/api\/missions\/([^/]+)\/result$/, (_, __, ___, [id]) => views.result(id)],
    ['GET', /^\/api\/missions\/([^/]+)\/files$/, (_, url, ___, [id]) => {
      const p = url.searchParams.get('path');
      if (!p) return views.files(id);
      const r = views.fileContent(id, p);
      if (r.status !== 200) throw httpError(r.status, r.error);
      return r;
    }],
    ['GET', /^\/api\/observability$/, () => views.observability({ running: runningSummary() })],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      checkRequest(req);
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        openSSE(req, res);
        return;
      }
      const sse = url.pathname.match(/^\/api\/missions\/([^/]+)\/events$/);
      if (req.method === 'GET' && sse) {
        const id = sse[1];
        if (!store.get(id)) throw httpError(404, 'missão não encontrada');
        const after = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0);
        const client = openSSE(req, res);
        client.filter = id;
        for (const e of store.readEvents(id, { afterSeq: after })) res.write(`id: ${e.seq}\nevent: mission\ndata: ${JSON.stringify(e)}\n\n`);
        return;
      }
      for (const [method, re, handler, skipIdCheck] of routes) {
        const m = url.pathname.match(re);
        if (!m || method !== req.method) continue;
        if (!skipIdCheck && m.slice(1).some((id) => !store.validId(id))) throw httpError(404, 'missão não encontrada');
        const out = await handler(req, url, res, m.slice(1));
        if (out === null || out === undefined) throw httpError(404, 'não encontrado');
        return sendJSON(res, res.statusCode === 201 ? 201 : 200, out);
      }
      if (url.pathname.startsWith('/api/')) throw httpError(404, 'rota não encontrada');
      if (req.method === 'GET' && serveStatic(req, res, url.pathname)) return;
      throw httpError(404, 'não encontrado');
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      sendJSON(res, e.status || 500, { error: e.status ? e.message : 'erro interno' });
      if (!e.status) process.stderr.write(`[minhaia api] ${e.stack}\n`);
    }
  });

  /** Encerra de verdade: workers, streams SSE abertos e conexões keep-alive, com prazo. */
  async function shutdown({ deadlineMs = 6000 } = {}) {
    manager.shutdown();
    for (const c of sseClients) { try { c.res.end(); } catch { /* já fechado */ } }
    sseClients.clear();
    const closed = new Promise((r) => server.close(() => r()));
    server.closeAllConnections();
    const until = Date.now() + deadlineMs;
    while (manager.running.size && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    await Promise.race([closed, new Promise((r) => setTimeout(r, 500))]);
    unsubscribe();
    unsubscribeChat();
  }

  server.on('close', () => { unsubscribe(); unsubscribeChat(); manager.shutdown(); });
  return { server, manager, shutdown };
}

async function start({ port = Number(process.env.MINHAIA_PORT || 4317), host = process.env.MINHAIA_HOST || '127.0.0.1' } = {}) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('a API da MinhaIA só escuta em loopback (MINHAIA_HOST deve ser 127.0.0.1/localhost/::1)');
  const { server, manager, shutdown } = createServer();
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, manager, shutdown, port: /** @type {import('net').AddressInfo} */ (server.address()).port, host })));
}

module.exports = { createServer, start };
