import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

async function enableMocking() {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS !== 'false') {
    const { worker } = await import('./mocks/browser');
    return worker.start({ onUnhandledRequest: 'bypass' });
  }
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
