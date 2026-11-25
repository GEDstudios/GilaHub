import '@fontsource-variable/figtree';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource-variable/frank-ruhl-libre';
import '@fontsource-variable/heebo';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';

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
  window.addEventListener('load', () => {
    const sw = swContainer();
    if (!sw) return;
    // A new deploy installs a new worker, which takes over right away.
    // If an older one was in charge, tell the app a fresh version is ready.
    const hadController = !!sw.controller;
    sw.addEventListener('controllerchange', () => {
      if (hadController) window.dispatchEvent(new Event('gila:update'));
    });
    sw.register('/sw.js')
      .then((reg) => {
        // Installed apps stay open for days: look for updates whenever they come back.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('[gila] service worker', err));
  });
}
