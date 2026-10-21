const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startApi, req, waitFinished } = require('./helpers');

const chat = require('../src/chat/store');

function tmpDir(prefix = 'minhaia-chat-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function withChatsDir(t) {
  const dir = tmpDir('minhaia-chats-');
  const saved = process.env.MINHAIA_CHATS_DIR;
  process.env.MINHAIA_CHATS_DIR = dir;
  t.after(() => {
    if (saved === undefined) delete process.env.MINHAIA_CHATS_DIR;
    else process.env.MINHAIA_CHATS_DIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('chat: append/lista redigem segredos, validam id e montam preâmbulo com truncamento', (t) => {
  withChatsDir(t);
  const pid = 'prj_0123456789ab';
  const m1 = chat.append(pid, { role: 'user', text: 'crie a função soma', missionId: 'mia_abc12345' });
  assert.match(m1.id, /^msg_[0-9a-f]{12}$/);
  assert.strictEqual(m1.missionId, 'mia_abc12345');

  const segredo = `minha chave é gsk_${'A'.repeat(30)}`;
  const m2 = chat.append(pid, { role: 'assistant', text: segredo });
  assert.ok(!m2.text.includes('gsk_'), 'segredo redigido antes de gravar');
  assert.match(m2.text, /\[REDACTED\]/);

  const raw = fs.readFileSync(chat.fileFor(pid), 'utf8');
  assert.ok(!raw.includes('gsk_'), 'nada de segredo no arquivo');

  assert.strictEqual(chat.list(pid).length, 2);
  assert.strictEqual(chat.list(pid, { limit: 1 }).length, 1);
  assert.deepStrictEqual(chat.list('prj_naoexiste00'), []);
  assert.throws(() => chat.append('../../etc', { role: 'user', text: 'x' }), /id de projeto inválido/);
  assert.throws(() => chat.append(pid, { role: 'user', text: '   ' }), /vazia/);

  const pre = chat.contextPreamble(pid);
  assert.match(pre, /Contexto da conversa anterior/);
  assert.match(pre, /Usuário: crie a função soma/);
  assert.match(pre, /MinhaIA: minha chave é/);
  assert.strictEqual(chat.contextPreamble('prj_naoexiste00'), '');
});

test('chat: resposta perdida num reinício é reconciliada ao ler a conversa', (t) => {
  withChatsDir(t);
  const jobsDir = tmpDir('minhaia-jobs-');
  const savedJobs = process.env.MINHAIA_JOBS_DIR;
  process.env.MINHAIA_JOBS_DIR = jobsDir;
  t.after(() => {
    if (savedJobs === undefined) delete process.env.MINHAIA_JOBS_DIR;
    else process.env.MINHAIA_JOBS_DIR = savedJobs;
    fs.rmSync(jobsDir, { recursive: true, force: true });
  });
  const jobs = require('../src/missions/store');
  const { reconcile } = require('../src/chat/reconcile');
  const pid = 'prj_0123456789ab';

  const feito = jobs.create('criar soma.js', { projectId: pid });
  jobs.update(feito.id, { status: 'CONCLUIDA' });
  chat.append(pid, { role: 'user', text: 'criar soma.js', missionId: feito.id });

  const rodando = jobs.create('ainda rodando', { projectId: pid });
  jobs.update(rodando.id, { status: 'EXECUTANDO' });
  chat.append(pid, { role: 'user', text: 'outra coisa', missionId: rodando.id });

  assert.strictEqual(reconcile(pid), 1, 'só o pedido de missão terminada ganha resposta');
  assert.strictEqual(reconcile(pid), 0, 'reconciliação é idempotente');
  const msgs = chat.list(pid);
  assert.strictEqual(msgs.length, 3);
  const resposta = msgs.find((m) => m.role === 'assistant');
  assert.match(resposta.text, /Concluída/);
  assert.strictEqual(resposta.missionId, feito.id);
});

test('chat: reinício do servidor não perde a resposta do assistente (rota reconcilia)', async (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'leiame.txt'), 'projeto de teste');
  const regDir = tmpDir('minhaia-reg-');
  const chatsDir = tmpDir('minhaia-chats-');
  const jobsDir = tmpDir('minhaia-jobs-');
  t.after(() => { fs.rmSync(regDir, { recursive: true, force: true }); fs.rmSync(chatsDir, { recursive: true, force: true }); fs.rmSync(jobsDir, { recursive: true, force: true }); });
  const env = { MINHAIA_PROJECTS_FILE: path.join(regDir, 'projetos.json'), MINHAIA_CHATS_DIR: chatsDir, MINHAIA_JOBS_DIR: jobsDir };

  const api1 = await startApi({ stub: true, env });
  const p = await req(api1.base, 'POST', '/api/projects', { body: { path: dir } });
  const r = await req(api1.base, 'POST', `/api/projects/${p.json.id}/chat`, { body: { text: 'criar soma.js e validar' } });
  await waitFinished(api1.manager, r.json.job.id);

  // simula o servidor caindo ANTES de gravar a resposta: sobram só os pedidos do usuário
  const file = chat.fileFor(p.json.id);
  const soPedidos = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && JSON.parse(l).role === 'user');
  fs.writeFileSync(file, `${soPedidos.join('\n')}\n`);
  await api1.close();

  const api2 = await startApi({ stub: true, env });
  t.after(() => api2.close());
  const got = await req(api2.base, 'GET', `/api/projects/${p.json.id}/chat`);
  assert.strictEqual(got.status, 200);
  assert.strictEqual(got.json.messages.length, 2, JSON.stringify(got.json.messages));
  assert.strictEqual(got.json.messages[1].role, 'assistant');
  assert.match(got.json.messages[1].text, /Concluída/);
});

test('chat do projeto via API: missão com contexto e resposta do assistente ao terminar', async (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'leiame.txt'), 'projeto de teste');
  const regDir = tmpDir('minhaia-reg-');
  const chatsDir = tmpDir('minhaia-chats-');
  t.after(() => { fs.rmSync(regDir, { recursive: true, force: true }); fs.rmSync(chatsDir, { recursive: true, force: true }); });
  const api = await startApi({ stub: true, env: { MINHAIA_PROJECTS_FILE: path.join(regDir, 'projetos.json'), MINHAIA_CHATS_DIR: chatsDir } });
  t.after(() => api.close());
  const selectedModel = require('../src/models/catalog').list().find((model) => model.available);

  const p = await req(api.base, 'POST', '/api/projects', { body: { path: dir } });
  const projectId = p.json.id;

  let r = await req(api.base, 'POST', `/api/projects/${projectId}/chat`, { body: { text: 'criar soma.js e validar', ...(selectedModel ? { modelId: selectedModel.id } : {}) } });
  assert.strictEqual(r.status, 201);
  assert.ok(r.json.message.missionId, 'mensagem vinculada à missão');
  const job1 = r.json.job;
  assert.strictEqual(job1.projectId, projectId);
  assert.equal(job1.modelId, selectedModel ? selectedModel.id : null);

  const f1 = await waitFinished(api.manager, job1.id);
  assert.strictEqual(f1.status, 'CONCLUIDA');

  r = await req(api.base, 'GET', `/api/projects/${projectId}/chat`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.messages.length, 2, JSON.stringify(r.json.messages));
  assert.strictEqual(r.json.messages[0].role, 'user');
  assert.strictEqual(r.json.messages[1].role, 'assistant');
  assert.match(r.json.messages[1].text, /Concluída/);
  assert.match(r.json.messages[1].text, /soma\.js/);
  if (selectedModel) {
    assert.match(r.json.messages[1].text, new RegExp(`Modelo utilizado: ${selectedModel.id}|fallback`));
    const calls = (await req(api.base, 'GET', `/api/missions/${job1.id}/logs`)).json.filter((e) => e.type === 'llm.end' && e.ok);
    assert.ok(calls.some((e) => e.model === selectedModel.id), 'a chamada do TEST-STUB usou o modelo selecionado');
  }
  assert.strictEqual(r.json.messages[1].missionId, job1.id);

  // segunda mensagem: o objetivo da missão carrega o contexto da conversa anterior
  r = await req(api.base, 'POST', `/api/projects/${projectId}/chat`, { body: { text: 'agora ajuste a mensagem final' } });
  assert.strictEqual(r.status, 201);
  const job2 = r.json.job;
  const det = await req(api.base, 'GET', `/api/missions/${job2.id}`);
  assert.match(det.json.job.objective, /Contexto da conversa anterior/);
  assert.match(det.json.job.objective, /Pedido atual: agora ajuste a mensagem final/);
  await waitFinished(api.manager, job2.id);

  r = await req(api.base, 'POST', `/api/projects/${projectId}/chat`, { body: { text: '' } });
  assert.strictEqual(r.status, 400);
  r = await req(api.base, 'GET', '/api/projects/prj_naoexiste00/chat');
  assert.strictEqual(r.status, 404);
});

test('API de sessões: cria conversas isoladas e mantém cada missão no contexto selecionado', async (t) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minhaia-session-project-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minhaia-session-data-'));
  t.after(() => { fs.rmSync(projectDir, { recursive: true, force: true }); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = await startApi({ stub: true, env: {
    MINHAIA_PROJECTS_FILE: path.join(dataDir, 'projects.json'), MINHAIA_CHATS_DIR: path.join(dataDir, 'chat'),
    MINHAIA_JOBS_DIR: path.join(dataDir, 'jobs'),
  } });
  t.after(async () => api.close());
  const project = (await req(api.base, 'POST', '/api/projects', { body: { path: projectDir } })).json;
  const a = (await req(api.base, 'POST', `/api/projects/${project.id}/sessions`, { body: { title: 'Conversa A' } })).json;
  const b = (await req(api.base, 'POST', `/api/projects/${project.id}/sessions`, { body: { title: 'Conversa B' } })).json;
  assert.match(a.id, /^ses_[a-f0-9]{12}$/);
  await req(api.base, 'POST', `/api/projects/${project.id}/chat`, { body: { text: 'pedido da conversa A', sessionId: a.id } });
  assert.strictEqual((await req(api.base, 'GET', `/api/projects/${project.id}/chat?sessionId=${a.id}`)).json.messages.length, 1);
  assert.strictEqual((await req(api.base, 'GET', `/api/projects/${project.id}/chat?sessionId=${b.id}`)).json.messages.length, 0);
  const sessions = (await req(api.base, 'GET', `/api/projects/${project.id}/sessions`)).json;
  assert.strictEqual(sessions.length, 2);
  assert.strictEqual((await req(api.base, 'GET', `/api/projects/${project.id}/chat?sessionId=ses_000000000000`)).status, 404);
});
