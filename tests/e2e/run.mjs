// End-to-end: two people, two browsers, one local relay (wrangler dev).
// Pairs Guy and Hila, checks live sync both ways, smart routing, that
// "Only me" items never reach the partner, and the shared Ideas list. Saves screenshots for review.
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

/** The +, then what to make: 'task' (or a thing to buy), 'project' or 'note'. */
async function plus(p, what = 'task') {
  await p.locator('.fab').first().click();
  await p.locator(`.addmenu__item--${what}`).click();
}

/** Add through the black + (the only way to add): write on the card, Enter. Shopping stays open: Done closes it. */
async function addVia(p, lines, { shopping = false } = {}) {
  for (let i = 0; i < lines.length; i++) {
    if (!shopping || i === 0) {
      await plus(p);
      await p.locator('.composer__input').waitFor({ timeout: 5000 });
    }
    await p.locator('.composer__input').fill(lines[i]);
    await p.locator('.composer__input').press('Enter');
    await p.waitForTimeout(250);
  }
  if (shopping) await p.locator('.composer').getByRole('button', { name: 'Done', exact: true }).click();
  await p.waitForTimeout(300);
}
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

  await check('Settings on his own: one page, "Your person?" on the card', async () => {
    await guy.goto(`${url}/settings`);
    await guy.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
    await guy.getByRole('button', { name: 'Your person?' }).waitFor({ timeout: 5000 });
    await guy.waitForTimeout(600);
    await guy.screenshot({ path: resolve(shots, '03s-settings-solo-full.png'), fullPage: true });
    if (await guy.getByRole('heading', { name: /Bottom bar|Today page/ }).count()) throw new Error('Settings still edits the bar or Today');
    await guy.goto(`${url}/`);
    await guy.getByRole('heading', { name: /Guy!/, level: 1 }).waitFor();
  });

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
    await addVia(guy, ['2 milk', 'עגבניות', 'light bulbs'], { shopping: true });
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
    await plus(hila);
    await hila.locator('.composer__input').fill('Milk');
    await hila.locator('.composer__input').press('Enter');
    await hila.getByText(/already on the list/).waitFor({ timeout: 5000 });
    await hila.locator('.composer').getByRole('button', { name: 'Done', exact: true }).click();
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
    await addVia(guy, ['Ring for Hila 💍', 'Book dinner friday']);
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
    await addVia(hila, ['Fix the kettle @guy']);
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
    await plus(guy);
    await guy.locator('.composer__input').fill('Water the balcony plants @hila today');
    await guy.locator('.sheet .echip', { hasText: 'Ask Hila' }).click();
    await guy.getByRole('switch', { name: 'Needs my OK when done' }).click();
    await guy.locator('.composer__input').press('Enter');
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
  await check('Chores: a plain project; a repeating chore rolls forward when ticked', async () => {
    // An old /chores link lands on Projects; Chores is a folder like any other.
    await guy.goto(`${url}/chores`);
    await guy.getByRole('heading', { name: 'Projects', level: 1 }).waitFor();
    await guy.locator('.projcard', { hasText: /^Chores/ }).first().click();
    await guy.getByRole('heading', { name: 'Chores', exact: true, level: 1 }).waitFor();
    await addVia(guy, ['Water the plants every week']);
    await shot(guy, '10-chores');
    const row = guy.locator('li.row', { hasText: 'Water the plants' });
    await row.getByRole('checkbox').click();
    await guy.getByText(/fresh again/).waitFor({ timeout: 5000 });
  });

  await check('Projects: create a new one (no suggestions, just its name)', async () => {
    await guy.goto(`${url}/lists`);
    await guy.locator('.projcard--new').first().click();
    if (await guy.locator('.sheet .tokens .token').count()) throw new Error('New project still suggests projects');
    // The phone's Back closes the sheet, and you're still on Projects.
    await guy.goBack();
    await guy.locator('.sheet').waitFor({ state: 'detached', timeout: 3000 });
    if (new URL(guy.url()).pathname !== '/lists') throw new Error(`Back left Projects: ${guy.url()}`);
    await guy.locator('.projcard--new').first().click();
    await guy.locator('.sheet .ccard__input').fill('Next trip');
    await guy.getByRole('button', { name: /create project/i }).click();
    await guy.getByRole('heading', { name: 'Next trip', level: 1 }).waitFor({ timeout: 5000 });
    await shot(guy, '12-project');
  });


  await check('New: the "+" asks Hila from the composer, with an OK', async () => {
    await guy.goto(`${url}/`);
    await plus(guy);
    await guy.getByRole('textbox', { name: 'What needs doing?' }).fill('Return the library books @hila');
    await guy.locator('.sheet .echip', { hasText: 'Ask Hila' }).click();
    await guy.getByRole('switch', { name: 'Needs my OK when done' }).click();
    await shot(guy, '13-composer-ask');
    await guy.getByRole('button', { name: 'Add', exact: true }).click();
    // It goes to the last project added to (here Chores, from the chores check): follow the toast there.
    const added = guy.getByText(/^Added to /);
    await added.waitFor({ timeout: 5000 });
    const where = (await added.innerText()).replace(/^Added to /, '').trim();
    await guy.goto(`${url}/lists`);
    await guy.locator('.projcard__name', { hasText: new RegExp(`^${where}$`) }).click();
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
    const rows = () => guy.locator('.homecards .homecard:not(.is-lifted) .homecard__title').allInnerTexts();
    const before = await rows();
    if (before.join() !== 'Waiting on you,Today,This week,Coming up,Hila did') throw new Error(`unexpected slots: ${before.join(', ')}`);
    await guy.getByRole('button', { name: 'Hide Coming up' }).click();
    await waitFor(async () => !(await rows()).includes('Coming up'), 3000, 'Coming up hidden');
    await guy.locator('.homeghost', { hasText: 'Coming up' }).waitFor({ timeout: 3000 });
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
      // Scrolled to it: at the top, or as far as the page goes with it fully in view.
      return guy.locator('#home-asks').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && (r.top < 200 || r.bottom <= innerHeight);
      });
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
    const slots = await guy.locator('.homecards .homecard:not(.is-lifted) .homecard__title').allInnerTexts();
    if (slots.join() !== 'Waiting on you,Today,This week,Coming up,Hila did') throw new Error(`after reset: ${slots.join(', ')}`);
    await guy.getByRole('button', { name: 'Done', exact: true }).click();
  });

  // ---------- Settings
  await check('Settings: color, and Check for updates is honest', async () => {
    await guy.goto(`${url}/settings`);
    await guy.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
    await guy.waitForTimeout(600);
    await guy.screenshot({ path: resolve(shots, '18-settings-paired-full.png'), fullPage: true });
    await guy.locator('.mecard').evaluate((e) => scrollBy(0, e.getBoundingClientRect().top - 100));
    await guy.getByRole('button', { name: 'Color', exact: true }).click();
    await guy.getByRole('radio', { name: 'pink, Hila’s' }).waitFor({ timeout: 3000 });
    await shot(guy, '21-settings-color-paired');
    await guy.getByRole('button', { name: 'Color', exact: true }).click();
    await guy.evaluate(() => (window.__stay = 'here'));
    const pill = guy.getByRole('button', { name: 'Check for updates' });
    await pill.scrollIntoViewIfNeeded();
    await pill.click();
    await guy.getByRole('button', { name: 'You’re up to date' }).waitFor({ timeout: 12000 });
    await shot(guy, '22-settings-up-to-date');
    if ((await guy.evaluate(() => window.__stay)) !== 'here') throw new Error('the page reloaded');
  });

  await check('Projects: Guy drags To do onto his bar; Hila’s bar stays hers', async () => {
    const keys = (p) => p.locator('nav.tabbar:not(.tabbar--preview) [data-key]').evaluateAll((els) => els.map((e) => e.dataset.key).filter((k) => k !== '__gap'));
    await hila.goto(`${url}/`);
    await hila.getByRole('heading', { name: /Hila!/, level: 1 }).waitFor();
    const hilaBefore = (await keys(hila)).join();
    await guy.goto(`${url}/lists`);
    await guy.getByRole('heading', { name: 'Projects', level: 1 }).waitFor();
    const cdp = await guyCtx.newCDPSession(guy);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const folder = guy.locator('.projslot', { has: guy.locator('.projcard__name', { hasText: /^To do$/ }) });
    await folder.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await guy.waitForTimeout(300);
    const f = await folder.boundingBox();
    const from = { x: f.x + f.width / 2, y: f.y + f.height / 2 };
    await touch('touchStart', from.x, from.y);
    await guy.waitForTimeout(450);
    if (!(await guy.locator('nav.tabbar.is-receiving').count())) throw new Error('the bar did not rise to meet the folder');
    const shop = await guy.locator('nav.tabbar [data-key="shop"]').boundingBox();
    const to = { x: shop.x + shop.width - 3, y: shop.y + shop.height / 2 };
    for (let i = 1; i <= 30; i++) {
      await touch('touchMove', from.x + ((to.x - from.x) * i) / 30, from.y + ((to.y - from.y) * i) / 30);
      await guy.waitForTimeout(16);
    }
    await guy.waitForTimeout(350);
    if (!(await guy.locator('.dragwrap .tabchip').count())) throw new Error('over the bar the folder should be a tab');
    await shot(guy, '20b-projects-folder-over-bar');
    await touch('touchEnd', to.x, to.y);
    await guy.getByText('To do is in the bar').waitFor({ timeout: 3000 });
    const mine = await keys(guy);
    if (mine.length !== 4 || mine[1] !== 'shop' || !mine[2].startsWith('l:')) throw new Error(`Guy's bar after the drop: ${mine}`);
    await hila.waitForTimeout(1500);
    await hila.reload();
    await hila.getByRole('heading', { name: /Hila!/, level: 1 }).waitFor();
    const hilaAfter = (await keys(hila)).join();
    if (hilaAfter !== hilaBefore) throw new Error(`Hila's bar changed: ${hilaBefore} → ${hilaAfter}`);
  });

  await check('Settings: Hila sees Guy on her card and can turn request alerts off', async () => {
    await hila.goto(`${url}/settings`);
    await hila.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
    await hila.locator('.mecard__tag', { hasText: 'Guy' }).waitFor({ timeout: 5000 });
    await hila.getByText('You and Guy · together since').waitFor({ timeout: 5000 });
    const alerts = hila.getByRole('switch', { name: 'Request alerts' });
    if ((await alerts.getAttribute('aria-checked')) !== 'true') throw new Error('request alerts should start on');
    await hila.waitForTimeout(400);
    await hila.screenshot({ path: resolve(shots, '23-settings-hila-full.png'), fullPage: true });
    await alerts.click();
    await waitFor(async () => (await alerts.getAttribute('aria-checked')) === 'false', 3000, 'alerts off');
    await alerts.click();
  });

  // ---------- Ideas
  const IDEA = 'Pin a project to the top of Today';
  const IDEA2 = 'Pin a project to the top of Today, with its count';
  await check('Ideas: Guy writes one; Hila sees it with his dot and a new-dot on her tag', async () => {
    await guy.goto(`${url}/`);
    await guy.getByRole('heading', { name: /Guy!/, level: 1 }).waitFor();
    await guy.locator('.ideatag').click();
    await guy.getByRole('dialog', { name: 'Ideas for Gila Hub' }).waitFor();
    const box = guy.getByRole('textbox', { name: 'New idea' });
    await box.fill(IDEA);
    await box.press('Enter');
    await guy.getByRole('button', { name: IDEA, exact: true }).waitFor({ timeout: 3000 });
    await shot(guy, '24-ideas-guy');
    await guy.keyboard.press('Escape');
    await guy.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 });

    await hila.goto(`${url}/`);
    await hila.getByRole('heading', { name: /Hila!/, level: 1 }).waitFor();
    await hila.locator('.ideatag .ideatag__dot').waitFor({ timeout: 15000 });
    const label = await hila.locator('.ideatag').getAttribute('aria-label');
    if (label !== 'Ideas for Gila Hub, 1 open, new from Guy') throw new Error(`tag says: ${label}`);
    await shot(hila, '25-ideas-hila-tag');
    await hila.locator('.ideatag').click();
    const row = hila.locator('li.idea', { hasText: IDEA });
    await row.waitFor({ timeout: 3000 });
    const dot = await row.locator('.idea__dot').evaluate((e) => getComputedStyle(e).backgroundColor);
    if (dot !== 'rgb(36, 209, 254)') throw new Error(`Guy's dot should be sky, got ${dot}`);
    await row.getByText('Guy · ').waitFor({ timeout: 3000 });
  });

  await check('Ideas: Hila edits and resolves it; Guy sees it under Resolved by Hila', async () => {
    await hila.getByRole('button', { name: IDEA, exact: true }).click();
    const edit = hila.getByRole('textbox', { name: 'Edit idea' });
    await edit.fill(IDEA2);
    await edit.press('Enter');
    const row = hila.locator('li.idea', { hasText: IDEA2 });
    await row.getByText('edited by Hila').waitFor({ timeout: 3000 });
    await shot(hila, '26-ideas-hila-edited');
    await row.getByRole('checkbox', { name: IDEA2 }).click();
    await hila.locator('.sheet li.idea:not(.is-done)').waitFor({ state: 'detached', timeout: 3000 });
    await hila.locator('.sheet').getByRole('heading', { name: /Resolved/ }).waitFor({ timeout: 3000 });
    await hila.keyboard.press('Escape');

    await guy.locator('.ideatag .ideatag__dot').waitFor({ timeout: 15000 });
    await guy.locator('.ideatag').click();
    const sheet = guy.locator('.sheet');
    await sheet.getByRole('heading', { name: /Resolved/ }).waitFor({ timeout: 5000 });
    if (await sheet.locator('li.idea:not(.is-done)').count()) throw new Error('the idea is still open for Guy');
    await sheet.getByRole('button', { name: 'Show' }).click();
    const done = sheet.locator('li.idea.is-done', { hasText: IDEA2 });
    await done.getByText('Resolved by Hila').waitFor({ timeout: 3000 });
    await shot(guy, '27-ideas-guy-resolved');
    await guy.keyboard.press('Escape');
    await guy.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 });
    if (await guy.locator('.ideatag__dot').count()) throw new Error('the new-dot stayed after Guy looked');
  });

  await check('Notes: Guy sticks one on Shopping; Hila finds it from Today, reads it and peels it off', async () => {
    const NOTE = 'Don’t forget the milk 💛';
    await guy.goto(`${url}/shop`);
    await guy.locator('.notebtn').click();
    await guy.getByRole('dialog', { name: 'A note for Hila' }).waitFor();
    // Long words at the biggest size never run off the paper.
    const clipped = () =>
      guy.evaluate(() => [...document.querySelectorAll('.sheet .nf__text')].filter((n) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1).length);
    await guy.getByRole('textbox', { name: 'Your note' }).fill('Don’t forget the milk, the eggs, the good bread from the corner place, and call your mum back tonight ✨ jumpy gql');
    await guy.getByRole('button', { name: 'Text size' }).click();
    await guy.getByRole('slider', { name: 'Text size' }).fill('30');
    await guy.waitForTimeout(250);
    await shot(guy, '27b-note-long');
    if (await clipped()) throw new Error('the words run off the note');
    await guy.getByRole('button', { name: 'Text size' }).click();
    await guy.getByRole('textbox', { name: 'Your note' }).fill(NOTE);
    await guy.getByRole('button', { name: 'Paper' }).click();
    await guy.getByRole('radio', { name: 'pink' }).click();
    // The words a size by hand.
    await guy.getByRole('button', { name: 'Text size' }).click();
    await guy.getByRole('slider', { name: 'Text size' }).fill('13');
    // A photo on it, drawn on.
    await guy.locator('.sheet input[type=file]').setInputFiles(new URL('./.out/10-chores.png', import.meta.url).pathname);
    await guy.locator('.sheet .nf__photo img').waitFor({ timeout: 5000 });
    // Its tray opens by itself: cut it into a heart.
    const ph = guy.locator('.sheet .nf__photo');
    await guy.getByRole('radio', { name: 'Heart' }).click();
    await guy.locator('.sheet .nf__photo--heart').waitFor({ timeout: 3000 });
    // A tap on the photo closes its tray (and opens it again): the shape stays a heart.
    await ph.click();
    await guy.locator('.noteedit__tray').waitFor({ state: 'detached', timeout: 3000 });
    await ph.click();
    await guy.getByRole('radio', { name: 'Heart' }).waitFor({ timeout: 3000 });
    if (!(await guy.locator('.sheet .nf__photo--heart').count())) throw new Error('tapping the photo changed its shape');
    // Hold it and drag it down and left: it moves on the note.
    const pb = await ph.boundingBox();
    await guy.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await guy.mouse.down();
    await guy.waitForTimeout(520);
    await guy.mouse.move(pb.x + pb.width / 2 - 120, pb.y + pb.height / 2 + 160, { steps: 8 });
    await guy.mouse.up();
    await guy.mouse.click(5, 300);
    const pb2 = await ph.boundingBox();
    if (!(pb2.y > pb.y + 100 && pb2.x < pb.x - 60)) throw new Error(`the photo didn't move: ${JSON.stringify(pb)} → ${JSON.stringify(pb2)}`);
    await shot(guy, '28-note-write');
    // The pencil: draw right on the note.
    await guy.getByRole('button', { name: 'Draw on the note' }).click();
    const pad = await guy.locator('.sheet .nf__draw').boundingBox();
    await guy.mouse.move(pad.x + pad.width * 0.15, pad.y + pad.height * 0.85);
    await guy.mouse.down();
    for (let i = 1; i <= 8; i++) await guy.mouse.move(pad.x + pad.width * (0.15 + i * 0.07), pad.y + pad.height * (0.85 - Math.sin(i / 2.5) * 0.1));
    await guy.mouse.up();
    await guy.locator('.sheet .nf__ink path').waitFor({ timeout: 3000 });
    // A second line in another colour, then the eraser wipes it away.
    await guy.getByRole('radio', { name: 'sky' }).click();
    await guy.mouse.move(pad.x + pad.width * 0.2, pad.y + pad.height * 0.3);
    await guy.mouse.down();
    for (let i = 1; i <= 6; i++) await guy.mouse.move(pad.x + pad.width * (0.2 + i * 0.08), pad.y + pad.height * 0.3 + (i % 2) * 12);
    await guy.mouse.up();
    await shot(guy, '28a-note-pen');
    const paths = () => guy.locator('.sheet .sticky .nf__ink').first().locator('path').count();
    if ((await paths()) !== 2) throw new Error(`expected two lines, found ${await paths()} paths`);
    await guy.getByRole('button', { name: 'Eraser' }).click();
    // (Reaching the eraser can scroll the sheet: measure the note again.)
    const pad2 = await guy.locator('.sheet .nf__draw').boundingBox();
    await guy.mouse.move(pad2.x + pad2.width * 0.35, pad2.y + pad2.height * 0.22);
    await guy.mouse.down();
    await guy.mouse.move(pad2.x + pad2.width * 0.35, pad2.y + pad2.height * 0.4, { steps: 6 });
    await guy.mouse.up();
    if ((await paths()) !== 1) throw new Error(`the eraser should have left just the first line, found ${await paths()} paths`);
    await guy.getByRole('button', { name: 'Done drawing' }).click();
    await shot(guy, '28b-note-drawn');
    await guy.getByRole('button', { name: 'Stick it' }).click();
    await guy.locator('.stuck').waitFor({ timeout: 3000 });
    await shot(guy, '29-note-guy-shop');

    await hila.goto(`${url}/`);
    const notice = hila.locator('.notice--note');
    await notice.waitFor({ timeout: 15000 });
    if (!/Guy left you a note on Shopping/.test(await notice.innerText())) throw new Error(`Today says: ${await notice.innerText()}`);
    await shot(hila, '30-note-hila-today');
    await notice.click();
    const stuck = hila.locator('.stuck');
    await stuck.waitFor({ timeout: 3000 });
    await stuck.locator('.nf__photo img').waitFor({ timeout: 15000 });
    await stuck.locator('.nf__photo--heart').waitFor({ timeout: 3000 });
    await stuck.locator('.nf__ink path').waitFor({ timeout: 3000 });
    await hila.waitForTimeout(700);
    await shot(hila, '31-note-hila-shop');
    // A tap reads it.
    await stuck.locator('.sticky__text').click();
    await hila.getByRole('dialog', { name: 'A note' }).getByText(NOTE).waitFor({ timeout: 3000 });
    // …and it stays open (the tap's own click mustn't land on the sheet's veil).
    await hila.waitForTimeout(600);
    if (!(await hila.getByRole('dialog', { name: 'A note' }).count())) throw new Error('the note closed right after opening');
    await shot(hila, '32-note-hila-read');
    await hila.keyboard.press('Escape');
    await hila.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 });
    // Hold it, then drag it down and left; Guy sees it there too.
    const box = await stuck.boundingBox();
    await hila.mouse.move(box.x + 40, box.y + 30);
    await hila.mouse.down();
    await hila.waitForTimeout(550);
    await hila.mouse.move(box.x - 120, box.y + 260, { steps: 10 });
    await hila.mouse.up();
    // Still lifted (mouse): press anywhere else and drag round and in; it turns and shrinks.
    const lifted0 = await stuck.evaluate((n) => [parseFloat(n.style.getPropertyValue('--scale') || '1'), parseFloat(n.style.getPropertyValue('--rot'))]);
    const c = await stuck.boundingBox();
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    await hila.mouse.move(cx + 160, cy);
    await hila.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const ang = (i / 10) * 0.7;
      const d = 160 - i * 7;
      await hila.mouse.move(cx + d * Math.cos(ang), cy + d * Math.sin(ang));
    }
    await hila.mouse.up();
    const twisted = await stuck.evaluate((n) => [parseFloat(n.style.getPropertyValue('--scale')), parseFloat(n.style.getPropertyValue('--rot'))]);
    if (!(twisted[0] < lifted0[0] * 0.7) || Math.abs(twisted[1] - lifted0[1]) < 25) throw new Error(`dragging elsewhere didn't turn/size it: ${lifted0} → ${twisted}`);
    // A plain click elsewhere puts it down.
    await hila.mouse.click(5, 400);
    await hila.locator('.stuck.is-lifted').waitFor({ state: 'detached', timeout: 3000 });
    await shot(hila, '32b-note-moved');
    const top = await stuck.evaluate((n) => parseFloat(n.style.top));
    if (top < 250) throw new Error(`the note didn't move: top is ${top}`);
    await guy.waitForFunction(() => {
      const n = document.querySelector('.stuck');
      return n && parseFloat(n.style.top) > 250;
    }, null, { timeout: 15000 });
    // A finger holds it and moves it; a second finger, anywhere, turns and sizes it; let go, it's down.
    const before = await stuck.evaluate((n) => [parseFloat(n.style.getPropertyValue('--scale') || '1'), parseFloat(n.style.getPropertyValue('--rot')), n.getBoundingClientRect().top]);
    await stuck.evaluate(async (n) => {
      const r = n.getBoundingClientRect();
      const ax = r.left + r.width / 2;
      const ay = r.top + r.height / 2;
      const wait = (ms) => new Promise((r2) => setTimeout(r2, ms));
      n.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, clientX: ax, clientY: ay, bubbles: true, pointerType: 'touch', isPrimary: true }));
      await wait(500);
      const t = (id, x, y, target = n) => new Touch({ identifier: id, target, clientX: x, clientY: y });
      const fire = (type, touches, target = n) => target.dispatchEvent(new TouchEvent(type, { touches, changedTouches: touches, bubbles: true, cancelable: true }));
      // The holding finger moves down a bit…
      fire('touchmove', [t(1, ax, ay + 40)]);
      await wait(16);
      // …a second finger lands somewhere else on the screen, then twists and spreads.
      const far = document.querySelector('.band') ?? document.body;
      fire('touchstart', [t(1, ax, ay + 40), t(2, ax + 60, ay + 40, far)], far);
      for (let i = 1; i <= 10; i++) {
        const a = (i / 10) * 0.6;
        const d = 60 + i * 6;
        fire('touchmove', [t(1, ax, ay + 40), t(2, ax + d * Math.cos(a), ay + 40 + d * Math.sin(a), far)], far);
        await wait(16);
      }
      fire('touchend', [t(1, ax, ay + 40)], far);
      fire('touchend', []);
    });
    await hila.waitForTimeout(300);
    const note = await stuck.evaluate((n) => [parseFloat(n.style.getPropertyValue('--scale')), parseFloat(n.style.getPropertyValue('--rot')), n.getBoundingClientRect().top]);
    if (!(note[0] > before[0] * 1.5) || Math.abs(note[1] - before[1]) < 20) throw new Error(`a second finger didn't size/turn it: ${before} → ${note}`);
    if (await hila.locator('.stuck.is-lifted').count()) throw new Error('the note stayed up after letting go');
    // Guy sees it as Hila left it.
    await guy.waitForFunction((s) => {
      const n = document.querySelector('.stuck');
      return n && parseFloat(n.style.getPropertyValue('--scale')) > s;
    }, before[0] * 1.5, { timeout: 15000 });
    await hila.mouse.click(5, 400);
    await shot(hila, '32b2-note-pinched');
    // The tick: read, collected.
    await stuck.locator('.sticky__check').click();
    await stuck.waitFor({ state: 'detached', timeout: 3000 });
    await guy.locator('.stuck').waitFor({ state: 'detached', timeout: 15000 });
    await hila.goto(`${url}/lists`);
    await hila.locator('.pinboard .sticky', { hasText: NOTE }).waitFor({ timeout: 5000 });
    await hila.locator('.collected').scrollIntoViewIfNeeded();
    await shot(hila, '32c-notes-collected');

    // With the app open, the next one rings in from the top.
    await hila.goto(`${url}/`);
    await hila.waitForTimeout(800);
    await guy.goto(`${url}/lists`);
    await guy.locator('.notebtn').click();
    await guy.getByRole('textbox', { name: 'Your note' }).fill('Your turn for the bins 🗑️');
    await guy.getByRole('button', { name: 'Stick it' }).click();
    const card = hila.locator('.arrival');
    await card.waitFor({ timeout: 15000 });
    if (!/Guy left you a note/.test(await card.innerText())) throw new Error(`the card says: ${await card.innerText()}`);
    await hila.waitForTimeout(700);
    await shot(hila, '33-arrival');
    await card.locator('.arrival__main').click();
    await hila.locator('.stuck').waitFor({ timeout: 3000 });
  });

  await check('Notes stay out of the way while Today is being edited', async () => {
    await guy.goto(`${url}/`);
    await guy.locator('.notebtn').click();
    await guy.getByRole('textbox', { name: 'Your note' }).fill('Dinner at 8? 🍝');
    await guy.getByRole('button', { name: 'Stick it' }).click();
    await hila.goto(`${url}/`);
    const note = hila.locator('.stuck', { hasText: 'Dinner at 8' });
    await note.waitFor({ timeout: 15000 });
    await hila.getByRole('button', { name: 'Edit Today' }).click();
    await hila.getByRole('heading', { name: 'Edit Today', level: 1 }).waitFor();
    if (await note.isVisible()) throw new Error('the note shows while editing Today');
    if (await hila.locator('.notebtn').isVisible()) throw new Error('the note button shows while editing Today');
    await hila.keyboard.press('Escape');
    await hila.getByRole('heading', { name: 'Edit Today', level: 1 }).waitFor({ state: 'detached', timeout: 3000 });
    await note.waitFor({ state: 'visible', timeout: 3000 });
    await note.locator('.sticky__check').click();
    await note.waitFor({ state: 'detached', timeout: 3000 });
  });

  await check('Today: Waiting on you can show only what’s urgent, the rest a tap away', async () => {
    await hila.goto(`${url}/`);
    const asks = hila.locator('#home-asks');
    await asks.getByText('Return the library books').waitFor({ timeout: 5000 });
    await asks.getByRole('button', { name: 'Urgent only' }).click();
    await asks.getByText('Return the library books').waitFor({ state: 'detached', timeout: 3000 });
    await asks.getByRole('button', { name: /1 not urgent/ }).waitFor({ timeout: 3000 });
    await shot(hila, '34-asks-urgent-only');
    await asks.getByRole('button', { name: /1 not urgent/ }).click();
    await asks.getByText('Return the library books').waitFor({ timeout: 3000 });
    // It stays as picked (this phone).
    await hila.reload();
    await hila.locator('#home-asks').getByRole('button', { name: 'Urgent only', pressed: true }).waitFor({ timeout: 5000 });
    await hila.locator('#home-asks').getByRole('button', { name: 'Urgent only' }).click();
    await hila.locator('#home-asks').getByText('Return the library books').waitFor({ timeout: 3000 });
  });

  await check('The path: a task deep inside nested projects shows every step, and each step goes there', async () => {
    await guy.goto(`${url}/lists`);
    await guy.locator('.projcard__name', { hasText: /^Next trip$/ }).click();
    await guy.getByRole('heading', { name: 'Next trip', level: 1 }).waitFor({ timeout: 5000 });
    // The + makes a project inside this one.
    await guy.locator('.fab').first().click();
    await guy.getByRole('menuitem', { name: 'Project inside Next trip' }).click();
    await guy.locator('.sheet .ccard__input').fill('Packing');
    await guy.getByRole('button', { name: /create project/i }).click();
    await guy.getByRole('heading', { name: 'Packing', level: 1 }).waitFor({ timeout: 5000 });
    const path = () => guy.locator('.crumbs--path').innerText().then((t) => t.replace(/\s+/g, ' ').trim());
    if ((await path()) !== 'Projects Next trip') throw new Error(`Packing's path: ${await path()}`);
    await addVia(guy, ['Passport']);
    // A new task can go under one: pick Passport in the composer's tree, and it's a subtask.
    await plus(guy);
    await guy.locator('.composer__input').fill('Visa photos');
    await guy.locator('.sheet .echip', { hasText: 'Packing' }).click();
    await guy.locator('.desttree__pick', { hasText: 'Passport' }).click();
    await guy.locator('.sheet .echip', { hasText: '↳ Passport' }).waitFor({ timeout: 3000 });
    await shot(guy, '12a-subtask-pick');
    await guy.locator('.composer__input').press('Enter');
    await guy.keyboard.press('Escape');
    await guy.locator('li.row', { hasText: 'Passport' }).locator('.row__title').click();
    await guy.locator('li.row', { hasText: 'Visa photos' }).waitFor({ timeout: 3000 });
    await addVia(guy, ['Check the expiry']);
    await guy.locator('li.row', { hasText: 'Check the expiry' }).locator('.row__title').click();
    await guy.waitForTimeout(300);
    if ((await path()) !== 'Projects Next trip Packing Passport') throw new Error(`the task's path: ${await path()}`);
    await shot(guy, '12b-path');
    await guy.locator('.crumbs__go', { hasText: 'Next trip' }).click();
    await guy.getByRole('heading', { name: 'Next trip', level: 1 }).waitFor({ timeout: 3000 });
  });

  // ---------- Desktop
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const deskPage = await desk.newPage();
  await deskPage.goto(url);
  await deskPage.waitForTimeout(1500);
  // The live cursor (a computer's) must never stand between the mouse and the page.
  await deskPage.mouse.move(640, 430);
  const hit = await deskPage.evaluate(() => {
    const e = document.elementFromPoint(640, 430);
    return { tag: e?.tagName, cls: String(e?.className ?? ''), pe: getComputedStyle(document.documentElement).pointerEvents, live: !!document.querySelector('.livecursor') };
  });
  if (hit.tag === 'HTML' || /livecursor/.test(hit.cls) || hit.pe === 'none') throw new Error(`the cursor blocks the page: ${JSON.stringify(hit)}`);
  console.log('· ✓ Desktop: the live cursor draws over the page without taking its clicks');
  // …and the system's pointer never shows anywhere on the page (the live one is the only cursor).
  const leaks = await deskPage.evaluate(() => {
    if (!document.documentElement.classList.contains('has-livecursor')) return ['no live cursor'];
    return [document.documentElement, ...document.querySelectorAll('*')].filter((e) => !/^url\("data:image\/gif;base64,R0lGOD[^)]*\) 0 0, none$/.test(getComputedStyle(e).cursor)).map((e) => e.tagName + '.' + String(e.className).slice(0, 30));
  });
  if (leaks.length) throw new Error(`the system cursor shows on: ${leaks.slice(0, 5).join(', ')}`);
  console.log('· ✓ Desktop: the system pointer is hidden everywhere');
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
