import './styles/main.css';
import { loadUniverseDataset } from './data/loader';
import { AtlasApp } from './ui/AtlasApp';

async function bootstrap(): Promise<void> {
  const hudRoot = document.getElementById('hud-root');
  try {
    const dataset = await loadUniverseDataset();
    new AtlasApp(dataset);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown initialization error';
    if (hudRoot) {
      hudRoot.innerHTML = `
        <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#050608;color:#F6F5F1;text-align:center;">
          <div style="max-width:440px;border:1px solid rgba(198,183,155,0.4);border-radius:16px;padding:24px;background:rgba(20,24,33,0.9);">
            <h1 style="font-size:18px;margin-bottom:8px;">ATLAS — تعذّر تحميل بيانات العالم</h1>
            <p style="font-size:13px;color:#9CA3AF;margin-bottom:16px;"></p>
            <button type="button" onclick="window.location.reload()" style="background:#F6F5F1;color:#050608;border:none;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;">
              إعادة المحاولة
            </button>
          </div>
        </div>
      `;
      hudRoot.querySelector('p')!.textContent = message;
    }
  }
}

void bootstrap();
