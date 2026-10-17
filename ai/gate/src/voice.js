// Speech to text for Orbit's voice conversations, using the Whisper model built into Open WebUI on
// this machine (so your voice never leaves it). Signs in as the owner with the trusted header, which
// Open WebUI only accepts on its loopback port, and keeps the token for a while.
export function createVoice({ webui, email, name = 'Owner', fetchImpl = fetch }) {
  let token = null;
  let at = 0;

  async function auth(force = false) {
    if (token && !force && Date.now() - at < 30 * 60_000) return token;
    const r = await fetchImpl(`${webui}/api/v1/auths/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-orbit-email': email, 'x-orbit-name': name },
      body: JSON.stringify({ email: '', password: '' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) throw Object.assign(new Error('The speech service is still starting. Try again in a moment.'), { status: 503 });
    token = j.token;
    at = Date.now();
    return token;
  }

  const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac' };

  async function transcribe(buf, contentType = 'audio/webm') {
    const type = String(contentType).split(';')[0].trim().toLowerCase();
    const ext = EXT[type];
    if (!ext) throw Object.assign(new Error('That audio format is not supported.'), { status: 415 });
    const send = async (tok) => {
      const form = new FormData();
      form.append('file', new Blob([buf], { type }), `speech.${ext}`);
      return fetchImpl(`${webui}/api/v1/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: form });
    };
    let r = await send(await auth());
    if (r.status === 401 || r.status === 403) r = await send(await auth(true));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.detail || 'Could not understand the audio.'), { status: 502 });
    return { text: String(j.text || '').trim() };
  }

  return { transcribe };
}
