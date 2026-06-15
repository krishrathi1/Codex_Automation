import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { App } from './App';
import { useAuthStore } from './stores/auth-store';
import { installProductionErrorCollector } from './lib/error-collector';
import './index.css';

async function bootstrap() {
  await useAuthStore.getState().initialize();
  installProductionErrorCollector();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HelmetProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </HelmetProvider>
    </StrictMode>,
  );
}

void bootstrap();
