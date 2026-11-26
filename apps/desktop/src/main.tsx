import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AiStandaloneWindow } from './components/AiStandaloneWindow';
import { DialogProvider } from './components/DialogProvider';
import './index.css';

const isAiWindow =
  new URLSearchParams(window.location.search).get('window') === 'ai';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      {isAiWindow ? <AiStandaloneWindow /> : <App />}
    </DialogProvider>
  </StrictMode>
);
