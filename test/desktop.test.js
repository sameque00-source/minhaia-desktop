/* global document, innerWidth, window */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const electronBin = (() => {
  try { return require('electron'); } catch { return null; }
})();
const noDisplay = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const skip = !electronBin || !fs.existsSync(electronBin) ? 'electron não instalado' : noDisplay ? 'sem display' : false;

test('desktop: abre a UI, expõe a ponte de pasta e opera um projeto real', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minhaia-desktop-'));
  const projectDir = path.join(tmp, 'projeto');
  fs.mkdirSync(projectDir);
  const pageErrors = [];
  const app = await electron.launch({
    args: ['desktop/main.js'],
    cwd: root,
    env: {
      ...process.env,
      MINHAIA_DESKTOP_HIDDEN: process.env.MINHAIA_CAPTURE_ELECTRON === '1' ? '0' : '1',
      MINHAIA_PROJECTS_FILE: path.join(tmp, 'projects.json'),
      MINHAIA_CHATS_DIR: path.join(tmp, 'chat'),
      MINHAIA_JOBS_DIR: path.join(tmp, 'jobs'),
      NODE_ENV: 'test',
      MINHAIA_TEST_ADAPTERS: path.join(root, 'test', 'fixtures', 'stub-adapters.js'),
      MINHAIA_TEST_PROMPT_LOG: path.join(tmp, 'prompts.jsonl'),
    },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    if (process.env.MINHAIA_CAPTURE_ELECTRON === '1') {
      await page.waitForSelector('#welcome-title', { state: 'visible' });
      await page.waitForSelector('#project-pick', { state: 'visible' });
      await page.waitForSelector('#objective', { state: 'visible' });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(root, 'docs', 'estado-atual.png') });
    }
    await page.click('#project-add-open');
    await page.waitForSelector('#project-path', { state: 'visible' });

    assert.equal(await page.title(), 'MinhaIA');
    assert.match(page.url(), /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(await page.locator('#project-pick').isVisible(), true);
    assert.equal(await page.evaluate(() => typeof (/** @type {any} */ (window).minhaiaDesktop?.chooseFolder)), 'function');
    assert.equal(await page.evaluate(() => typeof (/** @type {any} */ (window).minhaiaDesktop?.openSecretsFolder)), 'function');
    assert.equal(await page.evaluate(() => typeof (/** @type {any} */ (window).minhaiaDesktop?.minimizeWindow)), 'function');
    assert.equal(await page.evaluate(() => typeof (/** @type {any} */ (window).minhaiaDesktop?.toggleMaximizeWindow)), 'function');
    assert.equal(await page.evaluate(() => typeof (/** @type {any} */ (window).minhaiaDesktop?.closeWindow)), 'function');

    await page.fill('#project-path', projectDir);
    await page.click('#project-add-btn');
    await page.waitForSelector('#projects .proj-name');
    assert.equal(await page.locator('#projects .proj-name').first().textContent(), 'projeto');
    assert.equal(await page.locator('#chat').isVisible(), true);
    await page.fill('#chat-input', 'criar soma.js e validar');
    await page.locator('#chat-input').press('Enter');
    await page.waitForFunction(() => /Concluída/.test(document.querySelector('#chat-messages .msg.assistant')?.textContent || ''), { timeout: 30000 });
    assert.match(fs.readFileSync(path.join(projectDir, 'soma.js'), 'utf8'), /function soma/);
    await page.setViewportSize({ width: 720, height: 800 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(await page.locator('#mobile-sidebar-toggle').isVisible(), true);
    await page.click('#mobile-sidebar-toggle');
    assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-open')), true);
    await page.locator('#projects .proj').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-open')), false);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
