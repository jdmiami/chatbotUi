// Keeps the "Image maker" / "Video maker" models installed in Open WebUI (a "pipe" function whose
// code ships with the gate). Signs in to Open WebUI as the owner with the trusted header, which
// Open WebUI only accepts on its loopback port.
import fs from 'node:fs/promises';

const FUNCTION_ID = 'studio';

export async function installStudioFunction({ webui, email, name = 'Owner', codePath, studioKey, fetchImpl = fetch, log = console }) {
  const content = await fs.readFile(codePath, 'utf8');
  const signin = await fetchImpl(`${webui}/api/v1/auths/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-orbit-email': email, 'x-orbit-name': name },
    body: JSON.stringify({ email: '', password: '' }),
  });
  const auth = await signin.json().catch(() => ({}));
  if (!signin.ok || !auth.token) throw new Error(`Open WebUI sign-in: ${signin.status}`);
  if (auth.role !== 'admin') throw new Error('Open WebUI: the owner account is not an admin');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` };
  const api = (p, init = {}) => fetchImpl(`${webui}/api/v1/functions${p}`, { ...init, headers });

  const meta = { description: 'Images and videos made on this AI machine', manifest: {} };
  const existing = await api(`/id/${FUNCTION_ID}`);
  const current = existing.ok ? await existing.json() : null;
  if (!current) {
    const r = await api('/create', { method: 'POST', body: JSON.stringify({ id: FUNCTION_ID, name: 'Studio', content, meta }) });
    if (!r.ok) throw new Error(`Open WebUI create function: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } else if (current.content !== content) {
    const r = await api(`/id/${FUNCTION_ID}/update`, { method: 'POST', body: JSON.stringify({ id: FUNCTION_ID, name: 'Studio', content, meta }) });
    if (!r.ok) throw new Error(`Open WebUI update function: ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  const now = await (await api(`/id/${FUNCTION_ID}`)).json();
  if (!now.is_active) await api(`/id/${FUNCTION_ID}/toggle`, { method: 'POST' });

  // The chat box's image button: point it at the image maker (the key changes on every start).
  if (studioKey) {
    const images = (p, init = {}) => fetchImpl(`${webui}/api/v1/images${p}`, { ...init, headers });
    const cfg = await (await images('/config')).json().catch(() => null);
    if (cfg) {
      const r = await images('/config/update', {
        method: 'POST',
        body: JSON.stringify({
          ...cfg,
          ENABLE_IMAGE_GENERATION: true,
          IMAGE_GENERATION_ENGINE: 'openai',
          IMAGE_GENERATION_MODEL: 'qwen-image-2.1',
          IMAGE_SIZE: '1328x1328',
          IMAGES_OPENAI_API_BASE_URL: 'http://127.0.0.1:8080/v1',
          IMAGES_OPENAI_API_KEY: studioKey,
        }),
      });
      if (!r.ok) log.warn?.(`[gate] Open WebUI image settings: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  }
  log.info?.('[gate] playground image/video makers installed');
}
