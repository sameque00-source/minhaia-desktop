const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { paths } = require('../src/config');
const { SKIP_NO_MASTER, masterStatus } = require('./helpers');

test('sync materializa o MASTER sem alterar nada nele', { skip: SKIP_NO_MASTER }, () => {
  const before = masterStatus();
  const lock = require('../src/master/sync').sync();
  const after = masterStatus();
  assert.strictEqual(after, before, 'git status do MASTER mudou durante o sync');
  assert.strictEqual(after, '', 'MASTER deveria estar limpo');
  assert.ok(lock.fileCount > 300, `poucos arquivos no lock: ${lock.fileCount}`);
  assert.match(lock.masterGitHead || '', /^[0-9a-f]{40}$/);
});

test('verify confirma MASTER intacto e cópias íntegras', { skip: SKIP_NO_MASTER }, () => {
  const r = require('../src/master/verify').verify();
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.masterDrift.length, 0);
  assert.strictEqual(r.vendorTampered.length, 0);
  assert.strictEqual(r.masterGit.clean, true);
});

test('todos os patches declarados foram aplicados e nenhum caminho Windows sobrou', { skip: SKIP_NO_MASTER }, () => {
  const lock = JSON.parse(fs.readFileSync(paths.LOCK_PATH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(paths.MANIFEST_PATH, 'utf8'));
  assert.deepStrictEqual(lock.patches.map((p) => p.id).sort(), manifest.patches.map((p) => p.id).sort());
  const offenders = Object.keys(lock.files)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /C:\/Users\/Administrator|'C:', 'Users'/.test(fs.readFileSync(path.join(paths.ROOT, f), 'utf8')));
  assert.deepStrictEqual(offenders, []);
});

test('verify detecta cópia adulterada fora do sync', { skip: SKIP_NO_MASTER }, () => {
  const target = path.join(paths.CLAUDE_AGENTS_DIR, 'reviewer.md');
  const original = fs.readFileSync(target);
  try {
    fs.appendFileSync(target, '\n<!-- adulterado -->\n');
    const r = require('../src/master/verify').verify();
    assert.ok(r.vendorTampered.includes('.claude/agents/reviewer.md'));
    assert.strictEqual(r.ok, false);
  } finally {
    fs.writeFileSync(target, original);
  }
});

test('verify detecta arquivo intruso nos destinos gerados', { skip: SKIP_NO_MASTER }, () => {
  const intruder = path.join(paths.CLAUDE_AGENTS_DIR, 'intruso-teste.md');
  try {
    fs.writeFileSync(intruder, 'x');
    const r = require('../src/master/verify').verify();
    assert.ok(r.unexpectedLocal.includes('.claude/agents/intruso-teste.md'));
    assert.strictEqual(r.ok, false);
  } finally {
    fs.rmSync(intruder, { force: true });
  }
});

test('verify detecta link de runtime desviado', { skip: SKIP_NO_MASTER }, () => {
  const { isolateRuntime } = require('./helpers');
  const rt = isolateRuntime();
  try {
    const r = require('../src/master/verify').verify();
    assert.ok(r.badLinks.length > 0);
    assert.strictEqual(r.ok, false);
  } finally {
    rt.restore();
  }
  assert.strictEqual(require('../src/master/verify').verify().ok, true);
});

test('sync com patch inconsistente aborta sem tocar a instalação atual', { skip: SKIP_NO_MASTER }, () => {
  const original = fs.readFileSync(paths.MANIFEST_PATH, 'utf8');
  const lockBefore = fs.readFileSync(paths.LOCK_PATH, 'utf8');
  try {
    const m = JSON.parse(original);
    m.patches[0].expectCount = 999;
    fs.writeFileSync(paths.MANIFEST_PATH, JSON.stringify(m));
    assert.throws(() => require('../src/master/sync').sync(), /esperado 999/);
  } finally {
    fs.writeFileSync(paths.MANIFEST_PATH, original);
  }
  assert.strictEqual(fs.readFileSync(paths.LOCK_PATH, 'utf8'), lockBefore);
  assert.strictEqual(require('../src/master/verify').verify().ok, true);
  assert.ok(!fs.existsSync(path.join(paths.ROOT, '.sync-staging')));
});

test('verify sem o MASTER de origem cai em modo limitado: valida as cópias contra o lock', { skip: fs.existsSync(paths.LOCK_PATH) ? false : 'lock ausente (rode `minhaia sync`) — NÃO VALIDADO' }, () => {
  const saved = process.env.MINHAIA_MASTER_DIR;
  process.env.MINHAIA_MASTER_DIR = path.join(paths.ROOT, 'nao-existe-master-de-teste');
  try {
    const r = require('../src/master/verify').verify();
    assert.strictEqual(r.limited, true);
    assert.strictEqual(r.masterDir, null);
    assert.strictEqual(r.masterGit, null);
    assert.match(r.masterHead || '', /^[0-9a-f]{40}$/, 'HEAD registrado no lock');
    assert.ok(r.files > 300);
    assert.strictEqual(r.vendorTampered.length, 0);
    assert.strictEqual(r.missingLocal.length, 0);
    assert.strictEqual(r.ok, true, r.problems.join('; '));
  } finally {
    if (saved === undefined) delete process.env.MINHAIA_MASTER_DIR;
    else process.env.MINHAIA_MASTER_DIR = saved;
  }
});

test('pacote desktop exclui os links de runtime e nunca inclui segredos nem data/', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(paths.ROOT, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(paths.MANIFEST_PATH, 'utf8'));
  const files = pkg.build.files;
  for (const link of manifest.runtimeLinks.links) {
    assert.ok(files.includes(`!${link.at}`), `pacote precisa excluir ${link.at}`);
  }
  assert.ok(files.includes('!**/.secrets/**'), 'pacote não pode incluir .secrets');
  assert.ok(!files.includes('data/**'), 'pacote não pode incluir data/');
});

test('ensureRuntimeLinks não toca nos links existentes (instalação normal é no-op)', () => {
  const { ensureRuntimeLinks } = require('../src/master/sync');
  assert.deepStrictEqual(ensureRuntimeLinks({ runtimeLinks: { links: [] } }), []);
});

test('estado de runtime é link para data/, nunca diretório dentro de vendor/', { skip: SKIP_NO_MASTER }, () => {
  const memDir = path.join(paths.ENGINE_DIR, 'memoria', 'dados');
  assert.ok(fs.lstatSync(memDir).isSymbolicLink());
  assert.strictEqual(fs.realpathSync(memDir), fs.realpathSync(path.join(paths.DATA_DIR, 'memoria')));
});
