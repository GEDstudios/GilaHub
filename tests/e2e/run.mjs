// End-to-end: two people, two browsers, one local relay (wrangler dev).
// Pairs Guy and Hila, checks live sync both ways, smart routing, and that
// "Only me" items never reach the partner. Saves screenshots for review.
//
// Usage: npm run e2e            (builds, starts `wrangler dev`, runs, stops)
//        E2E_URL=http://… npm run e2e   (use an already running relay)
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shots = process.env.E2E_SHOTS ?? resolve(root, 'tests/e2e/.out');
mkdirSync(shots, { recursive: true });

const PORT = 8790;
let url = process.env.E2E_URL;
let server;

function log(...a) {
  console.log('·', ...a);
}

async function waitFor(fn, ms = 15000, label = 'condition') {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* retry */
    }
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

if (!url) {
  log('building…');
  execSync('npx vite build', { cwd: root, stdio: 'inherit' });
  log('starting wrangler dev…');
  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let out = '';
  server.stdout.on('data', (d) => (out += d));
  server.stderr.on('data', (d) => (out += d));
  url = `http://127.0.0.1:${PORT}`;
  try {
    await waitFor(async () => (await fetch(`${url}/api/health`)).ok, 90000, 'relay');
  } catch (e) {
    console.error(out);
    throw e;
  }
}
log('relay at', url);

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const guyCtx = await browser.newContext(phone);
const hilaCtx = await browser.newContext(phone);
const guy = await guyCtx.newPage();
const hila = await hilaCtx.newPage();
for (const [name, p] of [
  ['guy', guy],
  ['hila', hila],
]) {
  p.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
  p.on('console', (m) => m.type() === 'error' && console.error(`[${name}]`, m.text()));
}
const shot = (p, name) => p.screenshot({ path: resolve(shots, `${name}.png`) });
let failures = 0;
const check = async (label, fn) => {
  try {
    await fn();
    log('✓', label);
  } catch (e) {
    failures++;
    console.error('✗', label, '—', e.message.split('\n').slice(0, 3).join(' | '));
    await shot(guy, `FAIL-${failures}-guy`).catch(() => {});
    await shot(hila, `FAIL-${failures}-hila`).catch(() => {});
  }
};

try {
  // ---------- Guy starts the household
  await guy.goto(url);
  await guy.waitForTimeout(1200);
  await shot(guy, '01-welcome');
  await guy.getByRole('button', { name: /get started/i }).click();
  await guy.getByLabel('Your name').fill('Guy');
  await guy.getByRole('radio', { name: 'sky' }).click();
  await shot(guy, '02-name');
  await guy.getByRole('button', { name: /^next/i }).click();
  await guy.getByRole('button', { name: /home shopping/i }).click();
  await shot(guy, '02b-projects');
  await guy.getByRole('button', { name: /start with 4 projects/i }).click();
  await guy.getByRole('heading', { name: /Guy!/, level: 1 }).waitFor();
  await waitFor(() => guy.locator('.syncdot--synced').count(), 20000, 'guy synced');
  await shot(guy, '03-today-guy');

  // ---------- Invite Hila
  await guy.getByText('Bring your person in').click();
  const codeEl = guy.locator('.codepanel__code');
  await codeEl.waitFor({ timeout: 15000 });
  const code = (await codeEl.textContent()).trim();
  log('invite code', code);
  await shot(guy, '04-invite');
  await guy.keyboard.press('Escape');

  await hila.goto(url);
  await hila.getByRole('button', { name: /i have a code/i }).click();
  await hila.getByLabel('Invite code').fill(code);
  await hila.getByRole('button', { name: /^join$/i }).click();
  await hila.getByText(/Guy invited you/).waitFor({ timeout: 15000 });
  await hila.getByLabel('Your name').fill('Hila');
  await hila.getByRole('radio', { name: 'pink' }).click();
  await hila.getByRole('button', { name: /^join/i }).click();
  await hila.getByRole('heading', { name: /Hila!/, level: 1 }).waitFor();

  await check('Hila receives the shared projects', async () => {
    await hila.goto(`${url}/lists`);
    for (const name of ['Groceries', 'Home shopping', 'Chores', 'To do']) {
      await waitFor(async () => (await hila.locator('.projcard__name', { hasText: name }).count()) > 0, 20000, `${name} on hila`);
    }
    await shot(hila, '05-lists-hila');
  });

  // ---------- Shopping sync, both ways
  await check('Guy adds groceries; Hila sees them live', async () => {
    await guy.goto(`${url}/shop`);
    const bar = guy.getByRole('textbox', { name: 'Add an item' });
    await bar.fill('2 milk');
    await bar.press('Enter');
    await bar.fill('עגבניות');
    await bar.press('Enter');
    await bar.fill('light bulbs');
    await bar.press('Enter');
    await hila.goto(`${url}/shop`);
    await waitFor(async () => (await hila.locator('.row__title', { hasText: 'milk' }).count()) > 0, 15000, 'milk on hila');
    await waitFor(async () => (await hila.locator('.row__title', { hasText: 'עגבניות' }).count()) > 0, 15000, 'tomatoes on hila');
    await shot(guy, '06-shop-guy');
  });

  await check('Smart routing: light bulbs go to Home shopping', async () => {
    await hila.getByRole('radio', { name: /home shopping/i }).click();
    await waitFor(async () => (await hila.locator('.row__title', { hasText: 'light bulbs' }).count()) > 0, 10000, 'bulbs in home');
    await hila.getByRole('radio', { name: /both/i }).click();
  });

  await check('No duplicates: adding milk again says it exists', async () => {
    const bar = hila.getByRole('textbox', { name: 'Add an item' });
    await bar.fill('Milk');
    await bar.press('Enter');
    await hila.getByText(/already on the list/).waitFor({ timeout: 5000 });
    const n = await hila.locator('.row__title', { hasText: /^milk/i }).count();
    if (n !== 1) throw new Error(`expected 1 milk row, found ${n}`);
  });

  await check('Hila ticks milk; Guy sees it in the cart', async () => {
    await hila.locator('li.row', { hasText: 'milk' }).getByRole('checkbox').click();
    await shot(hila, '07-shop-hila');
    await guy.goto(`${url}/shop`);
    try {
      await waitFor(async () => (await guy.getByText(/in the cart/i).count()) > 0, 15000, 'cart on guy');
    } finally {
      await shot(guy, '07b-shop-guy');
    }
  });

  // ---------- Privacy
  await check('An "Only me" item never reaches the partner', async () => {
    await guy.goto(`${url}/lists`);
    await guy.locator('.projcard__name', { hasText: /^To do$/ }).click();
    const add = guy.getByRole('textbox', { name: 'Add to To do' });
    await add.fill('Ring for Hila 💍');
    await add.press('Enter');
    await add.fill('Book dinner friday');
    await add.press('Enter');
    await guy.locator('.row__title', { hasText: 'Ring for Hila' }).click();
    await guy.locator('.echip', { hasText: 'Ours' }).click();
    await guy.getByRole('radio', { name: /only me/i }).click();
    await shot(guy, '08-private-item');
    await guy.goBack();
    await hila.goto(`${url}/lists`);
    await hila.locator('.projcard__name', { hasText: /^To do$/ }).click();
    await waitFor(async () => (await hila.locator('.row__title', { hasText: 'Book dinner' }).count()) > 0, 15000, 'dinner on hila');
    await new Promise((r) => setTimeout(r, 1500));
    const leaked = await hila.locator('.row__title', { hasText: 'Ring for Hila' }).count();
    if (leaked) throw new Error('private item is visible to Hila!');
    const stored = await hila.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open('gila-hub');
          r.onsuccess = () => {
            const tx = r.result.transaction('entities', 'readonly');
            const all = tx.objectStore('entities').getAll();
            all.onsuccess = () => resolve(JSON.stringify(all.result));
          };
        }),
    );
    if (stored.includes('Ring for Hila')) throw new Error('private title found in Hila’s local database');
    await shot(hila, '09-todo-hila');
  });

  // ---------- Requests
  await check('Requests: Hila asks Guy with no date; it waits on Guy’s Today, tagged "Hila asked"', async () => {
    await hila.goto(`${url}/lists`);
    await hila.locator('.projcard__name', { hasText: /^To do$/ }).click();
    const add = hila.getByRole('textbox', { name: 'Add to To do' });
    await add.fill('Fix the kettle @guy');
    await add.press('Enter');
    await hila.locator('li.row', { hasText: 'Fix the kettle' }).getByText('Asked Guy').waitFor({ timeout: 5000 });
    await guy.goto(`${url}/`);
    const row = guy.locator('#home-asks li.row', { hasText: 'Fix the kettle' });
    try {
      await row.waitFor({ timeout: 10000 });
    } catch {
      log('ask NOT live on guy; reloading');
      await guy.reload();
      await row.waitFor({ timeout: 10000 });
    }
    await guy.locator('#home-asks').getByRole('heading', { name: /Waiting on you/ }).waitFor({ timeout: 5000 });
    await row.getByText('Hila asked').waitFor({ timeout: 5000 });
    await shot(guy, '09a-waiting-on-you');
  });

  await check('Requests: Guy asks Hila; it shows under "You asked Hila…" on his Today', async () => {
    await guy.goto(`${url}/lists`);
    await guy.locator('.projcard__name', { hasText: /^To do$/ }).click();
    const add = guy.getByRole('textbox', { name: 'Add to To do' });
    await add.fill('Water the balcony plants @hila today');
    await guy.locator('.addrow__chips .echip', { hasText: 'Ask Hila' }).click();
    await guy.getByRole('switch', { name: 'Needs my OK when done' }).click();
    await add.press('Enter');
    await guy.goto(`${url}/`);
    const line = guy.locator('.quietline', { hasText: 'You asked Hila for 1 thing' });
    await line.waitFor({ timeout: 5000 });
    await line.click();
    await guy.locator('li.row', { hasText: 'Water the balcony plants' }).getByText('Asked Hila · needs OK').waitFor({ timeout: 5000 });
    await shot(guy, '09a2-you-asked');
  });

  await check('Requests: Hila does it, Guy OKs it', async () => {
    await hila.goto(`${url}/`);
    const row = hila.locator('li.row', { hasText: 'Water the balcony plants' });
    try {
      await row.waitFor({ timeout: 8000 });
      log('request row appeared live');
    } catch {
      log('request row NOT live; reloading');
      await hila.reload();
      await row.waitFor({ timeout: 8000 });
      log('request row appeared after reload');
    }
    await row.getByText('Guy asked').waitFor({ timeout: 5000 });
    await shot(hila, '09a3-today-hila');
    await row.getByRole('checkbox').click();
    await hila.getByText(/Sent to Guy for an OK/).waitFor({ timeout: 5000 });
    await guy.goto(`${url}/`);
    const waiting = guy.locator('#home-asks li.row', { hasText: 'Water the balcony plants' });
    await waiting.getByText('Hila did it · OK?').waitFor({ timeout: 15000 });
    await shot(guy, '09b-waiting-ok');
    await waiting.getByRole('button', { name: 'OK', exact: true }).click();
    await hila.goto(`${url}/lists`);
    await hila.locator('.projcard__name', { hasText: /^To do$/ }).click();
    await waitFor(async () => (await hila.locator('li.row:not(.is-done)', { hasText: 'Water the balcony plants' }).count()) === 0, 15000, 'confirmed on hila');
  });

  // ---------- Chores
  await check('Chores: add one, tick it, it rolls forward', async () => {
    await guy.goto(`${url}/chores`);
    await guy.getByRole('heading', { name: 'Chores', exact: true, level: 1 }).waitFor();
    const add = guy.getByRole('textbox', { name: 'Add a chore' });
    await add.fill('Water the plants');
    await add.press('Enter');
    await shot(guy, '10-chores');
    const row = guy.locator('li.row', { hasText: 'Water the plants' });
    await row.getByRole('checkbox').click();
    await guy.getByText(/Fresh again/).waitFor({ timeout: 5000 });
  });

  await check('Projects: create a new one from a template', async () => {
    await guy.goto(`${url}/lists`);
    await guy.locator('.projcard--new').first().click();
    await guy.getByRole('button', { name: /next trip/i }).click();
    await guy.getByRole('button', { name: /create project/i }).click();
    await guy.getByRole('heading', { name: 'Next trip', level: 1 }).waitFor({ timeout: 5000 });
    await shot(guy, '12-project');
  });

  await check('New: the "+" asks Hila from the composer, with an OK', async () => {
    await guy.goto(`${url}/`);
    await guy.getByRole('button', { name: 'New', exact: true }).click();
    await guy.getByRole('textbox', { name: 'What needs doing?' }).fill('Return the library books @hila');
    await guy.locator('.sheet .echip', { hasText: 'Ask Hila' }).click();
    await guy.getByRole('switch', { name: 'Needs my OK when done' }).click();
    await shot(guy, '13-composer-ask');
    await guy.getByRole('button', { name: 'Add', exact: true }).click();
    await guy.getByText(/^Added to /).waitFor({ timeout: 5000 });
    await guy.goto(`${url}/lists`);
    await guy.locator('.projcard__name', { hasText: /^To do$/ }).click();
    await guy.locator('li.row', { hasText: 'Return the library books' }).getByText('Asked Hila · needs OK').waitFor({ timeout: 5000 });
  });

  // ---------- Today, arranged
  await check('Today: Guy hides "Coming up" and moves "This week" up; it sticks after a reload', async () => {
    await guy.goto(`${url}/`);
    await guy.getByRole('heading', { name: /Guy!/, level: 1 }).waitFor();
    await guy.waitForTimeout(1000);
    await shot(guy, '14-today-paired');
    await guy.screenshot({ path: resolve(shots, '14b-today-paired-full.png'), fullPage: true });
    await guy.getByRole('button', { name: 'Edit Today' }).click();
    await guy.getByRole('heading', { name: 'Edit Today', level: 1 }).waitFor();
    await guy.waitForTimeout(500);
    await shot(guy, '15-edit-today');
    const rows = () => guy.locator('.slots:not(.slots--fixed) .slot__title').allInnerTexts();
    const before = await rows();
    if (before.join() !== 'Waiting on you,Today,This week,Coming up,Hila did') throw new Error(`unexpected slots: ${before.join(', ')}`);
    await guy.getByRole('button', { name: 'Hide Coming up' }).click();
    await waitFor(async () => !(await rows()).includes('Coming up'), 3000, 'Coming up hidden');
    await guy.locator('.tray .token', { hasText: 'Coming up' }).waitFor({ timeout: 3000 });
    // Keyboard reorder from the grip: pick up, up twice, drop.
    await guy.getByRole('button', { name: 'Move This week' }).focus();
    for (const key of ['Space', 'ArrowUp', 'ArrowUp', 'Space']) {
      await guy.keyboard.press(key);
      await guy.waitForTimeout(250);
    }
    await waitFor(async () => (await rows()).join() === 'This week,Waiting on you,Today,Hila did', 3000, 'This week moved up');
    await shot(guy, '15b-edit-today-after');
    await guy.getByRole('button', { name: 'Done', exact: true }).click();
    await guy.reload();
    await guy.getByRole('heading', { name: /Guy!/, level: 1 }).waitFor();
    await guy.waitForTimeout(1000);
    const titles = await guy.locator('.home h2.section__title').allInnerTexts();
    if (titles.some((t) => t.startsWith('Coming up'))) throw new Error('Coming up is back after a reload');
    const week = titles.findIndex((t) => t.startsWith('This week'));
    const asks = titles.findIndex((t) => t.startsWith('Waiting on you'));
    if (week < 0 || asks < 0 || week > asks) throw new Error(`order after reload: ${titles.join(' | ')}`);
    await shot(guy, '16-today-arranged');
  });

  await check('Today: the "Hila" tag finds her asks, on the page or in a sheet; "Back to the default" restores it', async () => {
    await guy.locator('.tag--person').click();
    await waitFor(async () => {
      const top = await guy.locator('#home-asks').evaluate((el) => el.getBoundingClientRect().top);
      return top >= 0 && top < 200;
    }, 3000, 'scrolled to Waiting on you');
    await guy.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await guy.getByRole('button', { name: 'Edit Today' }).click();
    await guy.getByRole('button', { name: 'Hide Waiting on you' }).click();
    await guy.waitForTimeout(400);
    await guy.getByRole('button', { name: 'Done', exact: true }).click();
    await guy.locator('.tag--person').click();
    await guy.locator('.sheet', { hasText: 'Fix the kettle' }).waitFor({ timeout: 3000 });
    await shot(guy, '17-asks-sheet');
    await guy.keyboard.press('Escape');
    await guy.waitForTimeout(400);
    await guy.getByRole('button', { name: 'Edit Today' }).click();
    await guy.getByRole('button', { name: 'Back to the default' }).click();
    await guy.getByText('Today is back to the default').waitFor({ timeout: 3000 });
    const slots = await guy.locator('.slots:not(.slots--fixed) .slot__title').allInnerTexts();
    if (slots.join() !== 'Waiting on you,Today,This week,Coming up,Hila did') throw new Error(`after reset: ${slots.join(', ')}`);
    await guy.getByRole('button', { name: 'Done', exact: true }).click();
  });

  // ---------- Desktop
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const deskPage = await desk.newPage();
  await deskPage.goto(url);
  await deskPage.waitForTimeout(1500);
  await shot(deskPage, '11-desktop-welcome');
  await desk.close();
} finally {
  await browser.close();
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll end-to-end checks passed. Screenshots in', shots);
process.exit(0);
