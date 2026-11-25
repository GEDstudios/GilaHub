import '@fontsource-variable/outfit';
import '@fontsource-variable/fraunces/soft.css';
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
    swContainer()
      ?.register('/sw.js')
      .catch((err) => console.warn('[gila] service worker', err));
  });
}
