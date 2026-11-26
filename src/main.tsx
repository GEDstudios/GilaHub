import '@fontsource-variable/figtree';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource-variable/frank-ruhl-libre';
import '@fontsource-variable/heebo';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/desktop.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { swContainer } from './app/runtime';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) {
  const sw = swContainer();
  if (sw) {
    // This page's own code, as the build named it (e.g. /assets/index-3fa1.js).
    const mine = new URL(import.meta.url).pathname;
    let told = false;
    const ready = () => {
      if (told) return;
      told = true;
      window.dispatchEvent(new Event('gila:update'));
    };
    // A new deploy installs a new worker, which takes over right away. If an older one was in
    // charge, the page on screen is the old build: say a fresh version is ready.
    const hadController = !!sw.controller;
    sw.addEventListener('controllerchange', () => {
      if (hadController) ready();
    });
    /** Ask the worker in charge whether it knows this page's code; if not, this page is stale. */
    const compare = (reg: ServiceWorkerRegistration) => {
      const w = reg.active;
      if (!w || told) return;
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => {
        if (e.data && e.data.has === false) ready();
      };
      w.postMessage({ type: 'has', path: mine }, [ch.port2]);
    };
    const check = (reg: ServiceWorkerRegistration) =>
      reg
        .update()
        .catch(() => {})
        // Give a found update a moment to install and take over, then compare.
        .then(() => setTimeout(() => compare(reg), 4000));
    sw.register('/sw.js')
      .then((reg) => {
        compare(reg);
        // Installed apps stay open for days (and iPhone resumes them without a reload):
        // look again whenever they come back, and every 15 minutes while open.
        const again = () => document.visibilityState === 'visible' && void check(reg);
        document.addEventListener('visibilitychange', again);
        window.addEventListener('focus', again);
        window.addEventListener('pageshow', again);
        setInterval(again, 15 * 60_000);
        void check(reg);
      })
      .catch((err) => console.warn('[gila] service worker', err));
  }
}
