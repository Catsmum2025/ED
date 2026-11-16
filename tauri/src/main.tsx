import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import App from './App'
import './index.css'

/**
 * Popup windows (created lazily by the Rust side with the same index.html)
 * are routed to their popup pages based on the Tauri window label, before
 * HashRouter initializes. Mirrors Electron's loadURL(...#/popup/kind) split.
 */
function routePopupWindow() {
  try {
    const label = getCurrentWindow().label; // 'main' | 'popup-dict' | 'popup-translate'
    if ((label === 'popup-dict' || label === 'popup-translate') && !window.location.hash.startsWith('#/popup')) {
      window.location.hash = '#/popup/' + (label === 'popup-dict' ? 'dict' : 'translate');
    }
  } catch {
    /* not running under Tauri (plain browser preview) — ignore */
  }
}
routePopupWindow();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
