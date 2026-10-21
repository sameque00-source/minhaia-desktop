const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { startApi, req, waitFinished, MASTER } = require('./helpers');

const projects = require('../src/projects/store');
const browse = require('../src/projects/browse');

function tmpDir(prefix = 'minhaia-proj-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Aponta o registro de projetos para um arquivo temporário; devolve cleanup. */
function withRegistry(t) {
  const dir = tmpDir('minhaia-reg-');
  const saved = process.env.MINHAIA_PROJECTS_FILE;
  process.env.MINHAIA_PROJECTS_FILE = path.join(dir, 'projetos.json');
  t.after(() => {
    if (saved === undefined) delete process.env.MINHAIA_PROJECTS_FILE;
    else process.env.MINHAIA_PROJECTS_FILE = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('registro de projetos valida, reaproveita e remove só o registro', (t) => {
  withRegistry(t);
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'arquivo.txt'), 'oi');

  const a = projects.add(dir);
  assert.strictEqual(a.created, true);
  assert.match(a.project.id, /^prj_[a-z0-9]{12}$/);
  assert.strictEqual(a.project.path, dir);
  assert.ok(a.project.lastOpenedAt);

  const b = projects.add(dir);
  assert.strictEqual(b.created, false);
  assert.strictEqual(b.reused, true);
  assert.strictEqual(b.project.id, a.project.id);
  assert.strictEqual(projects.list().length, 1);

  const r = projects.remove(a.project.id);
  assert.strictEqual(r.removed, true);
  assert.strictEqual(projects.list().length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'arquivo.txt')), 'remover projeto não toca nos arquivos');
  assert.strictEqual(projects.remove('prj_naoexiste00').removed, false);
});

test('registro recusa raiz de unidade, inexistente, arquivo, MASTER e .secrets', (t) => {
  withRegistry(t);
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const root = path.parse(dir).root;
  assert.match(projects.normalizeDir(root).error, /raiz de uma unidade/);
  assert.match(projects.normalizeDir(path.join(dir, 'nao-existe')).error, /não encontrada/);
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, 'x');
  assert.match(projects.normalizeDir(file).error, /não é uma pasta/);
  assert.match(projects.normalizeDir('').error, /vazio/);
  const secrets = path.join(dir, '.secrets');
  fs.mkdirSync(secrets);
  assert.match(projects.normalizeDir(secrets).error, /segredos/);
  if (MASTER) assert.match(projects.normalizeDir(MASTER).error, /MASTER/);
  if (MASTER) assert.match(projects.normalizeDir(path.join(MASTER, '01-USO-DIRETO-CLAUDE')).error, /MASTER/);
});

test('navegação do projeto: listagem, leitura, busca e confinamento por realpath', (t) => {
  const dir = tmpDir();
  const outside = tmpDir('minhaia-fora-');
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# projeto\n');
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'console.log(1)\n');
  fs.writeFileSync(path.join(dir, 'src', 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), 'x');
  fs.writeFileSync(path.join(outside, 'segredo.txt'), 'não deveria aparecer');
  fs.symlinkSync(outside, path.join(dir, 'esc'), 'junction');

  const project = { id: 'prj_000000000000', name: 'p', path: dir };

  const listing = browse.listDir(project, '');
  assert.ok(listing.entries.some((e) => e.name === 'src' && e.dir));
  assert.ok(listing.entries.some((e) => e.name === 'README.md' && e.bytes > 0));
  const nm = listing.entries.find((e) => e.name === 'node_modules');
  assert.strictEqual(nm.ignored, true);
  assert.ok(!listing.entries.some((e) => e.name === 'esc'), 'link não aparece na listagem');

  assert.deepStrictEqual(browse.listDir(project, 'src').entries.map((e) => e.name), ['a.js', 'bin.dat']);
  assert.strictEqual(browse.readFile(project, 'README.md').content, '# projeto\n');
  assert.strictEqual(browse.readFile(project, 'src/bin.dat').binary, true);
  assert.strictEqual(browse.readFile(project, 'src/bin.dat').content, null);

  assert.throws(() => browse.listDir(project, '..'), (e) => e.status === 404);
  assert.throws(() => browse.listDir(project, 'esc'), (e) => e.status === 404, 'junction não é navegável');
  assert.throws(() => browse.readFile(project, 'esc/segredo.txt'), (e) => e.status === 404, 'leitura por junction é recusada');
  assert.throws(() => browse.readFile(project, '..\\arquivo-de-fora'), (e) => e.status === 404);

  const search = browse.searchNames(project, 'a.j');
  assert.ok(search.hits.some((h) => h.path === 'src/a.js'));
  assert.ok(!search.hits.some((h) => h.path.includes('segredo')));
  assert.throws(() => browse.searchNames(project, 'x'), (e) => e.status === 400);
});

test('guarda real: workspace do projeto aceita escritas legítimas e recusa junction que escapa', (t) => {
  const dir = tmpDir();
  const outside = tmpDir('minhaia-fora-');
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.symlinkSync(outside, path.join(dir, 'esc'), 'junction');
  const saved = process.env.MINHAIA_PROJECT_DIR;
  process.env.MINHAIA_PROJECT_DIR = dir;
  t.after(() => { if (saved === undefined) delete process.env.MINHAIA_PROJECT_DIR; else process.env.MINHAIA_PROJECT_DIR = saved; });

  const ws = require('../vendor/master/ia-avancado/executor/core/workspace.js');
  assert.strictEqual(ws.pastaWorkspace('missao_teste'), dir);
  assert.strictEqual(ws.garantirWorkspace('missao_teste'), dir);

  const ok = ws.resolverCaminhoSeguro('missao_teste', path.join('sub', 'novo.txt'));
  assert.strictEqual(ok, path.join(dir, 'sub', 'novo.txt'));
  fs.mkdirSync(path.dirname(ok), { recursive: true });
  fs.writeFileSync(ok, 'conteudo');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'sub', 'novo.txt'), 'utf8'), 'conteudo');

  assert.throws(() => ws.resolverCaminhoSeguro('missao_teste', 'esc/invadido.txt'), /bloqueado por segurança|fora do workspace/);
  assert.ok(!fs.existsSync(path.join(outside, 'invadido.txt')), 'nada foi escrito fora do projeto');

  const ferramentas = require('../vendor/master/ia-avancado/executor/core/ferramentas.js');
  const r = ferramentas.escreverArquivo('missao_teste', 't1', 'esc/invadido.txt', 'x');
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /bloqueado|fora do workspace/);

  const { assertInside } = require('../src/missions/scope');
  assertInside(dir, path.join(dir, 'sub', 'novo.txt'));
  assert.throws(() => assertInside(dir, path.join(outside, 'x.txt')));
});

test('sandbox: junction que escapa bloqueia execução; link interno é aceito', (t) => {
  const dir = tmpDir();
  const outside = tmpDir('minhaia-fora-');
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(dir, 'soma.js'), 'console.log(5)');
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib', 'util.js'), 'module.exports = 1;');
  fs.symlinkSync(outside, path.join(dir, 'esc'), 'junction');
  const saved = process.env.MINHAIA_PROJECT_DIR;
  process.env.MINHAIA_PROJECT_DIR = dir;
  t.after(() => { if (saved === undefined) delete process.env.MINHAIA_PROJECT_DIR; else process.env.MINHAIA_PROJECT_DIR = saved; });

  const { sandboxCommand } = require('../src/missions/instrument');
  const denied = sandboxCommand('missao_teste', 'node', ['soma.js']);
  assert.ok(denied.denied, 'execução com junction que escapa deve ser recusada');
  assert.match(denied.denied, /aponta para fora/);

  fs.rmSync(path.join(dir, 'esc'), { recursive: true, force: true });
  fs.symlinkSync(path.join(dir, 'lib'), path.join(dir, 'atalho-interno'), 'junction');
  const allowed = sandboxCommand('missao_teste', 'node', ['soma.js']);
  assert.ok(allowed.sandboxed, 'link que resolve para dentro do projeto é aceito');
  assert.strictEqual(allowed.workspace, dir);
});

test('preload da sandbox bloqueia criar symlink/hardlink mesmo com rede liberada', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const preload = path.join(__dirname, '..', 'src', 'missions', 'sandbox-preload.js');
  const code = [
    "const fs = require('fs');",
    "const saida = [];",
    "try { fs.symlinkSync(process.argv[1], process.argv[2], 'junction'); saida.push('CRIOU_SYNC'); } catch (e) { saida.push('NEGADO_SYNC:' + e.code); }",
    "try { fs.linkSync(process.argv[1], process.argv[3]); saida.push('CRIOU_HARD'); } catch (e) { saida.push('NEGADO_HARD:' + e.code); }",
    "require('fs/promises').symlink(process.argv[1], process.argv[4]).then(() => { saida.push('CRIOU_ASYNC'); console.log(saida.join(',')); }).catch((e) => { saida.push('NEGADO_ASYNC:' + e.code); console.log(saida.join(',')); });",
  ].join('\n');
  const alvo = path.join(dir, 'alvo');
  fs.mkdirSync(alvo);
  const r = spawnSync(process.execPath, ['--require', preload, '-e', code, preload, alvo, path.join(dir, 'l1'), path.join(dir, 'l2'), path.join(dir, 'l3')], {
    encoding: 'utf8',
    env: { ...process.env, MINHAIA_SANDBOX_ALLOW_NETWORK: '1' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /NEGADO_SYNC:ERR_MINHAIA_LINK_DENIED/);
  assert.match(r.stdout, /NEGADO_HARD:ERR_MINHAIA_LINK_DENIED/);
  assert.match(r.stdout, /NEGADO_ASYNC:ERR_MINHAIA_LINK_DENIED/);
  assert.ok(!r.stdout.includes('CRIOU'), 'nenhum link foi criado');
});

test('API de projetos: adicionar, navegar, buscar, remover (e missão com projectId)', async (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# meu projeto\n');
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log(1)\n');

  const regDir = tmpDir('minhaia-reg-');
  t.after(() => fs.rmSync(regDir, { recursive: true, force: true }));
  const api = await startApi({ stub: true, env: { MINHAIA_PROJECTS_FILE: path.join(regDir, 'projetos.json') } });
  t.after(() => api.close());

  let r = await req(api.base, 'POST', '/api/projects', { body: { path: dir } });
  assert.strictEqual(r.status, 201);
  const project = r.json;
  assert.match(project.id, /^prj_/);

  r = await req(api.base, 'POST', '/api/projects', { body: { path: dir } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.created, false);

  r = await req(api.base, 'POST', '/api/projects', { body: { path: path.join(dir, 'nao-existe') } });
  assert.strictEqual(r.status, 400);

  r = await req(api.base, 'GET', '/api/projects');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.length, 1);
  assert.strictEqual(r.json[0].available, true);

  r = await req(api.base, 'GET', `/api/projects/${project.id}/files`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.entries.some((e) => e.name === 'src' && e.dir));
  assert.ok(r.json.entries.some((e) => e.name === 'README.md'));

  r = await req(api.base, 'GET', `/api/projects/${project.id}/file?path=${encodeURIComponent('src/index.js')}`);
  assert.strictEqual(r.status, 200);
  assert.match(r.json.content, /console\.log\(1\)/);

  r = await req(api.base, 'GET', `/api/projects/${project.id}/file?path=${encodeURIComponent('../fora.txt')}`);
  assert.strictEqual(r.status, 404);

  r = await req(api.base, 'GET', `/api/projects/${project.id}/search?q=index`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.hits.some((h) => h.path === 'src/index.js'));

  r = await req(api.base, 'GET', '/api/projects/prj_naoexiste00');
  assert.strictEqual(r.status, 404);

  // missão real (dublê de teste) vinculada ao projeto: o workspace da missão é a pasta escolhida
  r = await req(api.base, 'POST', '/api/missions', { body: { objective: 'criar soma.js e validar', projectId: project.id } });
  assert.strictEqual(r.status, 201);
  const job = r.json;
  assert.strictEqual(job.projectId, project.id);
  const finished = await waitFinished(api.manager, job.id);
  assert.strictEqual(finished.status, 'CONCLUIDA');

  const final = await req(api.base, 'GET', `/api/missions/${job.id}`);
  assert.strictEqual(final.status, 200);
  assert.strictEqual(final.json.job.workspace, dir);
  const events = await req(api.base, 'GET', `/api/missions/${job.id}/logs`);
  assert.ok(events.json.some((e) => e.type === 'project' && e.id === project.id), 'evento project registrado');
  assert.ok(fs.existsSync(path.join(dir, 'soma.js')), 'soma.js gravado na pasta do projeto');
  const conteudo = fs.readFileSync(path.join(dir, 'soma.js'), 'utf8');
  assert.match(conteudo, /function soma/);

  r = await req(api.base, 'GET', `/api/missions/${job.id}/files`);
  assert.ok(r.json.some((f) => f.path === 'soma.js') || r.json.some((f) => f.path === 'src/index.js'), 'listagem da missão reflete o projeto');

  r = await req(api.base, 'DELETE', `/api/projects/${project.id}`, { body: {} });
  assert.strictEqual(r.status, 200);
  r = await req(api.base, 'GET', '/api/projects');
  assert.strictEqual(r.json.length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'soma.js')), 'remover o registro não apaga arquivos');
});

test('missão vinculada a projeto removido do registro vira BLOQUEADA, sem executar', async (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const regDir = tmpDir('minhaia-reg-');
  t.after(() => fs.rmSync(regDir, { recursive: true, force: true }));
  const api = await startApi({ stub: true, env: { MINHAIA_PROJECTS_FILE: path.join(regDir, 'projetos.json') } });
  t.after(() => api.close());

  let r = await req(api.base, 'POST', '/api/projects', { body: { path: dir } });
  const projectId = r.json.id;
  r = await req(api.base, 'POST', '/api/missions', { body: { objective: 'tarefa qualquer', projectId, start: false } });
  assert.strictEqual(r.status, 201);
  const jobId = r.json.id;
  await req(api.base, 'DELETE', `/api/projects/${projectId}`, { body: {} });
  r = await req(api.base, 'POST', `/api/missions/${jobId}/start`, { body: {} });
  assert.strictEqual(r.status, 200);
  const finished = await waitFinished(api.manager, jobId, 15000);
  assert.strictEqual(finished.status, 'BLOQUEADA');
  const detail = await req(api.base, 'GET', `/api/missions/${jobId}`);
  assert.match(detail.json.job.reason, /não encontrado no registro/);

  r = await req(api.base, 'POST', '/api/missions', { body: { objective: 'x', projectId: 'prj_naoexiste00' } });
  assert.strictEqual(r.status, 404);
});
