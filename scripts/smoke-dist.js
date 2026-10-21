'use strict';
/* global document, window */
// Valida o app EMPACOTADO (dist/win-unpacked): abre a janela oculta, adiciona uma pasta real,
// roda uma missão completa com o dublê de LLM (rotulada TEST-STUB) e confere o arquivo gerado.
// Requer `npm run dist` antes. Usa TEST-STUB para validar a integração local sem chamar provedor real.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const exeName = process.platform === 'win32' ? 'MinhaIA.exe' : 'MinhaIA';
const EXE = process.argv[2] || path.join(root, 'dist', exeName === 'MinhaIA.exe' ? 'win-unpacked' : 'linux-unpacked', exeName);

(async () => {
  if (!fs.existsSync(EXE)) throw new Error(`binário empacotado não encontrado: ${EXE} (rode \`npm run dist\`)`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minhaia-smoke-'));
  const projectDir = path.join(tmp, 'projeto');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'leiame.txt'), 'projeto do smoke');
  const app = await electron.launch({
    executablePath: EXE,
    env: {
      ...process.env,
      MINHAIA_DESKTOP_HIDDEN: '1',
      MINHAIA_PROJECTS_FILE: path.join(tmp, 'p.json'),
      MINHAIA_CHATS_DIR: path.join(tmp, 'chat'),
      MINHAIA_JOBS_DIR: path.join(tmp, 'jobs'),
      NODE_ENV: 'test',
      MINHAIA_TEST_ADAPTERS: path.join(root, 'test', 'fixtures', 'stub-adapters.js'),
      MINHAIA_TEST_STUB_DELAY_MS: '200',
    },
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForSelector('#workspace-project', { state: 'visible', timeout: 30000 });
    await page.waitForSelector('#project-pick', { state: 'visible' });
    await page.waitForSelector('#objective', { state: 'visible' });
    console.log('titulo:', await page.title(), '| url:', page.url());
    console.log('pasta inicial:', (await page.textContent('#workspace-project')).replace(/\s+/g, ' '));
    console.log('ponte:', JSON.stringify(await page.evaluate(() => {
      const b = /** @type {any} */ (window).minhaiaDesktop;
      return { pasta: typeof b?.chooseFolder, secrets: typeof b?.openSecretsFolder };
    })));

    await page.click('#project-add-open');
    await page.waitForSelector('#project-path', { state: 'visible' });
    await page.fill('#project-path', projectDir);
    await page.click('#project-add-btn');
    await page.waitForSelector('#projects .proj-name');
    await page.fill('#chat-input', 'Crie um script que soma dois números');
    await page.click('#chat-send');
    await page.waitForFunction(
      () => /Concluída/.test(document.querySelector('#chat-messages .msg.assistant')?.textContent || ''),
      null,
      { timeout: 120000 },
    );
    console.log('chat:', (await page.textContent('#chat-messages')).replace(/\s+/g, ' ').slice(0, 240));
    const gerados = fs.readdirSync(projectDir, { recursive: true }).join(', ');
    console.log('arquivos do projeto:', gerados);
    if (!gerados.includes('soma.js')) throw new Error('o arquivo gerado não apareceu na pasta do projeto');
    if (errors.length) throw new Error(`erros de página: ${errors.join(' | ')}`);
    console.log('SMOKE OK');
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('SMOKE FALHOU:', e && e.message);
  process.exit(1);
});
