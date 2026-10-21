/* global document, window */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SKIP_NO_MASTER, startApi } = require('./helpers');

const BROWSER = [process.env.MINHAIA_BROWSER_EXECUTABLE, '/opt/pw-browsers/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
let chromium = null;
try { ({ chromium } = require('playwright-core')); } catch { /* dependência de dev ausente */ }
const SKIP = SKIP_NO_MASTER || (!BROWSER && 'Chromium não encontrado — NÃO VALIDADO') || (!chromium && 'playwright-core não instalado');

async function openPage(base) {
  const browser = await chromium.launch({ executablePath: BROWSER });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(base);
  await page.waitForSelector('#system .chip');
  return { browser, page, problems };
}

test('UI do projeto: chat vira missão real e navegador de arquivos funciona sem HTML injetado', { skip: SKIP }, async (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minhaia-ui-proj-')));
  fs.writeFileSync(path.join(dir, 'leiame.txt'), 'conteúdo do projeto <img src=x onerror="window.__xss=1">');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'soma.js'), 'function soma(a, b) { return a + b; }');
  const regDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minhaia-ui-reg-'));
  const chatsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minhaia-ui-chat-'));
  const jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minhaia-ui-jobs-'));
  t.after(() => {
    for (const d of [dir, regDir, chatsDir, jobsDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  const api = await startApi({ stub: true, env: {
    MINHAIA_PROJECTS_FILE: path.join(regDir, 'projetos.json'),
    MINHAIA_CHATS_DIR: chatsDir,
    MINHAIA_JOBS_DIR: jobsDir,
    MINHAIA_TEST_STUB_DELAY_MS: '300',
  } });
  const { browser, page, problems } = await openPage(api.base);
  t.after(async () => { await browser.close(); await api.close(); });

  // guia de chaves: o chip de LLM abre o painel com o caminho real do .env
  const envFile = await page.evaluate(async () => (await (await fetch('/api/system')).json()).providers.envFile);
  assert.ok(/\.secrets/.test(envFile) && envFile.endsWith('.env'), `caminho do .env: ${envFile}`);
  await page.click('#system button.chip.err');
  await page.waitForSelector('#keys-guide:not([hidden])');
  assert.match(await page.textContent('#keys-guide'), /Chaves aceitas: .*API_KEY/);
  await page.click('#keys-guide button:has-text("Fechar")');
  assert.strictEqual(await page.isVisible('#keys-guide'), false);

  // adiciona a pasta real do usuário e abre o chat
  await page.fill('#project-path', dir);
  await page.click('#project-add-btn');
  await page.waitForFunction(() => (document.querySelector('#projects .proj-name')?.textContent || '').length > 0);
  assert.strictEqual(await page.isVisible('#chat'), true);

  // o pedido do chat vira uma missão real; a resposta-resumo aparece no fim
  await page.fill('#chat-input', 'Crie um script que soma dois números <img src=x onerror="window.__xss=1">');
  await page.click('#chat-send');
  await page.waitForFunction(() => document.querySelectorAll('#chat-messages .msg.user').length === 1);
  await page.waitForFunction(
    () => /Concluída/.test(document.querySelector('#chat-messages .msg.assistant')?.textContent || ''),
    null,
    { timeout: 60000 },
  );
  const resumo = await page.textContent('#chat-messages .msg.assistant');
  assert.match(resumo, /soma\.js/, 'resumo cita os arquivos reais da missão');
  assert.strictEqual(await page.evaluate(() => window.__xss), undefined, 'texto do usuário não pode virar HTML');

  // navegador de arquivos: listar, abrir e buscar (todo conteúdo entra como texto)
  await page.click('#btn-browse');
  await page.waitForSelector('#browse-list li button');
  assert.match(await page.textContent('#browse-path'), /^\//);
  const nomes = await page.$$eval('#browse-list li button', (bs) => bs.map((b) => b.textContent));
  assert.ok(nomes.includes('leiame.txt'), `arquivos listados: ${nomes.join(', ')}`);
  assert.ok(nomes.includes('src/'), `pastas listadas: ${nomes.join(', ')}`);

  await page.locator('#browse-list li button', { hasText: 'leiame.txt' }).click();
  await page.waitForFunction(() => /conteúdo do projeto/.test(document.querySelector('#browse-view')?.textContent || ''));
  assert.strictEqual(await page.evaluate(() => window.__xss), undefined, 'conteúdo de arquivo não pode virar HTML');

  await page.fill('#browse-search', 'soma');
  await page.press('#browse-search', 'Enter');
  await page.waitForFunction(() => /soma\.js/.test(document.querySelector('#browse-list')?.textContent || ''));
  await page.locator('#browse-list li button', { hasText: 'soma.js' }).first().click();
  await page.waitForFunction(() => /function soma/.test(document.querySelector('#browse-view')?.textContent || ''));

  assert.deepStrictEqual(problems, []);
});
