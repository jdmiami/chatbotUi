/**
 * The fast Make page (/lite): one plain HTML page with its own small styles and script, no Orbit,
 * no React, no orb. It loads in one response and works on an iPhone over a slow line. A five-step
 * walkthrough (What, Maker, Describe it, Extras, Make it) with "Do it for me" on every step, and
 * Eros, a story writer that turns an idea into a short adult story and one prompt per scene.
 *
 * It talks to what Orbit uses: /api/ai (the machine's state, Turn on with every GPU to pick from,
 * Turn off), /api/ai/gpus, /api/ai/token (the AI machine's address and a token for it) and
 * /api/orb/ai with task "free" (the NVIDIA writer whose one rule keeps everyone in it an adult;
 * the page also tells it: fictional adults only, never a real or famous person).
 *
 * The script below is written without backticks or "${" so it sits inside this file's strings as is.
 */

export const LITE_CSS = String.raw`
:root{--bg:#0d0c0b;--ink:#f2efe9;--ink2:#b9b3a8;--ink3:#857f75;--line:#2a2724;--card:#161412;--accent:#8b9cff;--warn:#ffb35c;--bad:#ff7a6b;--serif:"New York","Iowan Old Style",Georgia,"Times New Roman",serif;--ui:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 var(--ui);min-height:100dvh;padding:env(safe-area-inset-top) 0 0;overscroll-behavior-y:none}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.wrap{max-width:640px;margin:0 auto;padding:12px 16px calc(112px + env(safe-area-inset-bottom))}
.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0 12px;border-bottom:1px solid var(--line)}
.bar .st{flex:1 1 12em;min-width:0;color:var(--ink2);font-size:14px}
.bar .st b{color:var(--ink);font-weight:600}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ink3);margin-right:6px;vertical-align:1px}
.dot.on{background:#5fd38d}.dot.wait{background:var(--warn)}
h1{font:400 34px/1.05 var(--serif);letter-spacing:-.01em;margin:18px 0 4px}
.kick{font:600 12px/1.2 var(--ui);letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:18px 0 0}
.dek{color:var(--ink2);margin:6px 0 14px}
.dots{display:flex;gap:6px;margin:14px 0 0;overflow-x:auto;scrollbar-width:none}
.dots button{flex:0 0 auto;border:0;background:transparent;color:var(--ink3);font:600 12px/1 var(--ui);letter-spacing:.12em;padding:9px 11px;border-radius:999px}
.dots button[aria-current=step]{background:#1c1d33;color:var(--ink)}
.choices{display:flex;flex-direction:column;gap:10px}
.ch{display:flex;align-items:baseline;justify-content:space-between;gap:10px;width:100%;text-align:left;border:1px solid var(--line);background:var(--card);border-radius:16px;padding:16px;min-height:56px}
.ch .n{font:400 22px/1.15 var(--serif)}
.ch .s{color:var(--ink3);font-size:13px;white-space:nowrap}
.ch[aria-pressed=true]{border-color:var(--accent);background:#171a2e}
.row{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:11px 16px;min-height:44px}
.chip[aria-pressed=true]{border-color:var(--accent);background:#171a2e}
textarea,input[type=text]{width:100%;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:14px;font-size:16px;line-height:1.45;outline:none}
textarea:focus,input[type=text]:focus{border-color:var(--accent)}
textarea{min-height:150px;resize:vertical}
.sel{width:100%;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px 14px;font-size:16px;min-height:48px;margin:0 0 12px;-webkit-appearance:none;appearance:none}
label.f{display:block;color:var(--ink2);font-size:14px;margin:14px 0 6px}
.btn{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:12px 18px;min-height:46px;font-weight:600}
.btn.p{background:var(--ink);color:#111;border-color:var(--ink)}
.btn.a{background:#1c1d33;border-color:#2e3159;color:var(--ink)}
.btn.s{padding:8px 14px;min-height:38px;font-size:14px}
.btn:disabled{opacity:.5;cursor:default}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}
.note{color:var(--ink2);font-size:14px;margin:10px 0 0}
.note.bad{color:var(--bad)}
.nav{position:fixed;left:0;right:0;bottom:0;background:linear-gradient(transparent,var(--bg) 26%);padding:22px 16px calc(12px + env(safe-area-inset-bottom))}
.nav .in{max-width:640px;margin:0 auto;display:flex;gap:10px;align-items:center}
.nav .grow{flex:1}
.nav .next{font:italic 400 21px/1 var(--serif);padding:14px 22px;min-height:52px}
.nav .back{font:italic 400 19px/1 var(--serif)}
.sheet{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;z-index:5}
.sheet .in{background:#141210;border-top:1px solid var(--line);border-radius:22px 22px 0 0;width:100%;max-width:640px;max-height:86dvh;overflow:auto;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}
.sheet h2{font:400 26px/1.1 var(--serif);margin:4px 0 10px}
.gpu{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px 14px;margin:0 0 8px}
.gpu[aria-pressed=true]{border-color:var(--accent);background:#171a2e}
.gpu small{display:block;color:var(--ink3)}
.story{border-top:1px solid var(--line);margin:16px 0 0;padding:12px 0 0}
.story h3{font:400 24px/1.15 var(--serif);margin:0 0 6px}
.scene{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px 14px;margin:10px 0 0}
.scene p{margin:0 0 6px}
.scene .pr{color:var(--ink3);font-size:13px}
.prog{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:10px 0 0}
.prog span{display:block;height:100%;background:linear-gradient(90deg,#8b5cff,#22c1e6);width:0}
.out img,.out video{display:block;width:100%;border-radius:16px;margin:12px 0 0;background:#000}
.sum{margin:0;padding:0;list-style:none}
.sum li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.sum li span:first-child{color:var(--ink3)}
.sum li span:last-child{text-align:right;min-width:0;overflow-wrap:anywhere}
a{color:var(--accent)}
a.btn{color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.hide{display:none!important}
.pick{cursor:pointer;display:inline-flex;align-items:center}
.thumb{position:relative;display:inline-block}.thumb img{width:96px;height:96px;object-fit:cover;border-radius:12px;display:block}
.thumb .x{position:absolute;top:-6px;right:-6px;width:28px;height:28px;border-radius:50%;border:1px solid var(--line);background:#111;font-size:18px;line-height:1;padding:0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.tile{position:relative;aspect-ratio:1;border:0;padding:0;border-radius:10px;overflow:hidden;background:var(--card)}
.tile img{width:100%;height:100%;object-fit:cover;display:block}
.tile i{position:absolute;right:4px;bottom:4px;font:600 11px/1 var(--ui);background:rgba(0,0,0,.6);padding:4px 6px;border-radius:8px;font-style:normal}
@media (prefers-reduced-motion:no-preference){.pane{animation:in .18s ease-out}@keyframes in{from{opacity:.3;transform:translateX(8px)}to{opacity:1;transform:none}}}
`;

export const LITE_JS = String.raw`
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var STEPS = ['what', 'maker', 'describe', 'extras', 'make'];
  var TITLE = { what: 'What will it be?', maker: 'Who makes it', describe: 'Describe it', extras: 'Extras', make: 'Make it' };
  var SHORT = { what: 'What', maker: 'Maker', describe: 'Describe it', extras: 'Extras', make: 'Make it' };
  var DEFAULT = { image: 'qwen', video: 'h3-max', edit: 'edit', model3d: 'trellis2' };
  var NAME = { qwen: 'Qwen Uncensored', 'h3-max': 'H3 Max', edit: 'Edit with words', trellis2: '3D object' };
  var NOUN = { image: 'picture', video: 'video', edit: 'picture edit', model3d: '3D object' };
  var KINDS = [['image', 'A picture', 'about a minute'], ['video', 'A video', 'a few minutes'], ['edit', 'An edit', 'change a photo with words'], ['model3d', 'A 3D object', 'from one picture']];
  var photoMode = function () { return S.kind === 'edit' || S.kind === 'model3d'; };
  var S = { step: 0, kind: 'image', maker: '', prompt: '', size: 'portrait', seconds: 5, makers: null, status: null, grant: null, busy: '', story: null, eros: { idea: '', who: '', heat: 'steamy', scenes: 5 }, job: null, jobs: [], photos: [], items: null, view: null, style: '', note: '', writer: '', writers: null };
  try {
    var saved = JSON.parse(localStorage.getItem('orbit.lite') || '{}');
    ['kind', 'maker', 'prompt', 'size', 'seconds'].forEach(function (k) { if (saved[k] != null) S[k] = saved[k]; });
    if (saved.eros) S.eros = saved.eros;
    if (saved.writer) S.writer = saved.writer;
  } catch (e) {}
  function save() {
    try { localStorage.setItem('orbit.lite', JSON.stringify({ kind: S.kind, maker: S.maker, prompt: S.prompt, size: S.size, seconds: S.seconds, eros: S.eros, writer: S.writer })); } catch (e) {}
  }

  // ---- the site and the machine
  function api(path, opt) {
    opt = opt || {};
    return fetch(path, { method: opt.method || 'GET', headers: { 'content-type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.status === 401) { location.href = '/login?next=/lite'; throw new Error('Sign in again.'); }
        if (!r.ok) throw new Error(b.error || ('That did not work (' + r.status + ').'));
        return b;
      });
    });
  }
  function grant(force) {
    if (!force && S.grant && S.grant.exp - Date.now() > 120000) return Promise.resolve(S.grant);
    return api('/api/ai/token', { method: 'POST', body: {} }).then(function (r) {
      S.grant = r.url && r.token ? { url: r.url, token: r.token, exp: Date.now() + (r.expiresIn || 3600) * 1000 } : null;
      return S.grant;
    });
  }
  function machine(path, opt, retried) {
    opt = opt || {};
    return grant(retried).then(function (g) {
      if (!g) throw new Error('Your AI machine is not on yet.');
      return fetch(g.url + path, { method: opt.method || 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + g.token }, body: opt.body ? JSON.stringify(opt.body) : undefined }).then(function (r) {
        if (r.status === 401 && !retried) return machine(path, opt, true);
        return r.json().catch(function () { return {}; }).then(function (b) {
          if (!r.ok) throw new Error((b.error && (b.error.message || b.error)) || ('The AI machine answered ' + r.status + '.'));
          return b;
        });
      });
    }, function (err) { throw err; }).catch(function (err) {
      if (err instanceof TypeError) throw new Error('Could not reach your AI machine. It may be starting or just turned itself off.');
      throw err;
    });
  }
  var on = function () { return S.status && S.status.state === 'on'; };

  // ---- the NVIDIA writer (task "free": its one rule keeps everyone an adult)
  var ADULTS = 'Every character is a fictional adult, clearly over 18. Never a real, famous or named public person.';
  // NVIDIA's unfiltered writers, to pick from (Automatic: the site tries them in order).
  var WRITER_NAMES = {
    'nv-mistralai/mistral-nemo-12b-instruct': 'Mistral NeMo 12B \u00b7 quick, loose',
    'mistralai/mistral-large-2-instruct': 'Mistral Large 2 \u00b7 best writing, slower',
    'mistralai/mistral-7b-instruct-v0.3': 'Mistral 7B \u00b7 quickest, simplest',
    'mistralai/mistral-large-4-1t-a52b': 'Mistral Large 4 \u00b7 newest, biggest',
    'writer/palmyra-creative-122b': 'Palmyra Creative \u00b7 made for stories',
    'nvidia/mistral-nemo-minitron-8b-8k-instruct': 'Minitron 8B \u00b7 small, quick',
    'deepseek-ai/deepseek-v4.1-flash': 'DeepSeek V4.1 Flash \u00b7 sharp, may say no',
    'z-ai/glm-5.3-flash': 'GLM 5.3 Flash \u00b7 quick, may say no',
    'moonshotai/kimi-k2.6': 'Kimi K2.6 \u00b7 rich writing, may say no'
  };
  function loadWriters() {
    return api('/api/orb/ai').then(function (r) {
      var nv = (r.byProvider || []).filter(function (p) { return p.id === 'nvidia'; })[0];
      S.writers = nv && nv.models && Array.isArray(nv.models.free) ? nv.models.free : [];
      if (S.writer && S.writers.indexOf(S.writer) < 0) { S.writer = ''; save(); }
      draw();
    }).catch(function () { S.writers = []; });
  }
  function writerName(id) { return WRITER_NAMES[id] || id.split('/').pop(); }
  function write(system, user, maxTokens) {
    var ask = { task: 'free', messages: [{ role: 'system', content: system + ' ' + ADULTS }, { role: 'user', content: user }], max_tokens: maxTokens || 900, temperature: 0.9 };
    if (S.writer) { ask.model = S.writer; ask.prefer = 'nvidia'; }
    return api('/api/orb/ai', { method: 'POST', body: ask }).catch(function (err) {
      if (!S.writer) throw err;
      throw new Error(/turned this one down/.test(err.message) ? writerName(S.writer).split(' \u00b7')[0] + ' turned this one down. Pick another writer, or Automatic.' : writerName(S.writer).split(' \u00b7')[0] + ' did not answer (' + err.message + '). Pick another writer, or Automatic.');
    }).then(function (j) {
      var t = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      t = t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (t.indexOf('[not possible]') >= 0) throw new Error("That idea can't be made.");
      if (!t) throw new Error('The writer sent nothing. Try again.');
      return t;
    });
  }
  var what = function () { return S.kind === 'video' ? 'video' : S.kind === 'edit' ? 'picture edit (an instruction that changes a photo)' : 'picture'; };
  function promptSystem() {
    return 'You write one prompt for an AI ' + what() + ' maker. Describe who is in it (looks, hair, clothing or lack of it), what they do, the setting, light, camera and mood' +
      (S.kind === 'video' ? ', how they move and what we hear' : '') + '. One paragraph of 60 to 120 words, plain words, no title, no quotes, no lists. Reply with the prompt only.';
  }
  function doPrompt() {
    var idea = S.prompt.trim();
    return write(promptSystem(), idea ? 'Turn this into the prompt, keeping everything it says: ' + idea : 'Invent one striking, sensual idea and write its prompt.', 600).then(function (t) {
      S.prompt = t.replace(/^["']|["']$/g, '').trim();
      save();
    });
  }
  function doStory() {
    var e = S.eros;
    var n = Math.max(1, Math.min(8, Number(e.scenes) || 5));
    var heat = { romantic: 'romantic and tender, sensual but not explicit', steamy: 'steamy and seductive, sexy and suggestive', explicit: 'fully explicit, graphic sex between the adults, no holding back' }[e.heat] || 'steamy and seductive';
    var system = 'You are Eros, a writer of erotic short stories for the owner of this private tool. The heat: ' + heat + '. Write the story in exactly ' + n + ' scenes. ' +
      'Reply with JSON only, no other words: {"title":"...","characters":"one line on each character’s look, used again in every prompt","scenes":[{"story":"2 to 4 sentences of the story","prompt":"a detailed prompt for an AI ' + what() + ' maker showing this scene: who (repeat their looks), what they do, setting, light, camera' + (S.kind === 'video' ? ', motion and sound' : '') + '"}]}';
    var user = 'The idea: ' + (e.idea.trim() || 'surprise me') + (e.who.trim() ? '. Who is in it: ' + e.who.trim() : '') + '.';
    return write(system, user, Math.min(8192, 500 + n * 380)).then(function (t) {
      var a = t.indexOf('{'), b = t.lastIndexOf('}');
      var j = null;
      try { j = JSON.parse(t.slice(a, b + 1)); } catch (err) {}
      if (!j || !Array.isArray(j.scenes) || !j.scenes.length) throw new Error('The story came back in pieces. Try again.');
      S.story = { title: String(j.title || 'Untitled'), characters: String(j.characters || ''), scenes: j.scenes.map(function (s) { return { story: String(s.story || ''), prompt: String(s.prompt || '') }; }).filter(function (s) { return s.prompt; }) };
    });
  }

  // ---- the machine's state, Turn on (every GPU to pick from), Turn off
  /** Every new answer about the machine comes through here: on, its makers load; off, they go. */
  function setStatus(s) {
    var was = on();
    S.status = s;
    if (on() && (!was || !S.makers)) loadMakers();
    if (!on()) { S.makers = null; S.grant = null; }
    drawBar();
    draw();
  }
  function refresh() {
    return api('/api/ai').then(setStatus).catch(function (err) { S.status = { state: 'error', detail: err.message }; drawBar(); });
  }
  function loadMakers() {
    return machine('/_orbit/studio/makers').then(function (r) { S.makers = Array.isArray(r.makers) ? r.makers : []; draw(); }).catch(function () {});
  }
  function drawBar() {
    var s = S.status || { state: 'off' };
    var st = s.state;
    var words = st === 'on' ? 'on' : st === 'starting' ? 'starting' : st === 'downloading' ? 'loading its models' : st === 'unconfigured' ? 'not set up' : st === 'error' ? 'not answering' : 'off';
    var price = s.costPerHour ? ' · $' + Number(s.costPerHour).toFixed(2) + '/h' : '';
    var gal = st === 'on' ? '<button class="btn s" data-do="gal">Gallery</button>' : '';
    var btn = gal + (st === 'on' ? '<button class="btn s" data-do="off">Turn off</button>' : st === 'off' ? '<button class="btn s a" data-do="power">Turn on</button>' : '');
    $('#bar').innerHTML = '<span class="st"><span class="dot ' + (st === 'on' ? 'on' : st === 'starting' || st === 'downloading' ? 'wait' : '') + '"></span>AI machine: <b>' + words + '</b>' + esc(price) + '</span>' + btn + '<a class="btn s" href="/">Orbit</a>';
  }
  function power() {
    if (S.status && S.status.pickGpu) return gpuSheet();
    return start(undefined);
  }
  function start(gpu) {
    S.busy = 'power';
    return api('/api/ai', { method: 'POST', body: { action: 'start', gpu: gpu } }).then(function (s) { closeSheet(); setStatus(s); }).catch(function (err) { alert(err.message); }).then(function () { S.busy = ''; });
  }
  function gpuSheet() {
    var box = document.createElement('div');
    box.className = 'sheet';
    box.innerHTML = '<div class="in" role="dialog" aria-label="Pick a GPU"><p class="kick">Turn on</p><h2>Pick a GPU</h2><p class="note">Every GPU free right now, cheapest first.</p><div id="gpus"><p class="note">Looking…</p></div><div class="acts"><button class="btn p" data-do="go" disabled>Turn on</button><button class="btn" data-do="close">Cancel</button></div></div>';
    document.body.appendChild(box);
    var pick = null;
    api('/api/ai/gpus').then(function (r) {
      var list = r.options || [];
      pick = r.recommended || (list[0] && list[0].gpu) || null;
      $('#gpus', box).innerHTML = list.length ? list.map(function (o) {
        return '<button class="gpu" data-gpu="' + esc(o.gpu) + '" aria-pressed="' + (o.gpu === pick) + '"><span>' + esc(o.name) + (o.memoryGb ? ' ' + o.memoryGb + ' GB' : '') + '<small>' + esc(o.note) + '</small></span><span>$' + Number(o.pricePerHour).toFixed(2) + '/h' + (o.gpu === r.recommended ? '<small>suggested</small>' : '') + '</span></button>';
      }).join('') : '<p class="note">No GPU is free on GPU.ai right now. Try again in a few minutes.</p>';
      $('[data-do=go]', box).disabled = !pick;
    }).catch(function (err) { $('#gpus', box).innerHTML = '<p class="note bad">' + esc(err.message) + '</p>'; });
    box.addEventListener('click', function (e) {
      var g = e.target.closest('[data-gpu]');
      if (g) { pick = g.getAttribute('data-gpu'); box.querySelectorAll('[data-gpu]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === g)); }); $('[data-do=go]', box).disabled = false; }
      var d = e.target.closest('[data-do]');
      if (d && d.getAttribute('data-do') === 'go' && pick) start(pick);
      if ((d && d.getAttribute('data-do') === 'close') || e.target === box) closeSheet();
    });
  }
  function closeSheet() { var s = $('.sheet'); if (s) s.remove(); }
  function off() {
    if (!confirm('Turn the AI machine off? It stops costing money.')) return;
    api('/api/ai', { method: 'POST', body: { action: 'stop' } }).then(setStatus).catch(function (err) { alert(err.message); });
  }

  // ---- makers: every one for this kind; tapping one not loaded puts it in line
  function makersFor() {
    var kind = S.kind;
    if (!S.makers) return [{ id: DEFAULT[kind], name: NAME[DEFAULT[kind]], installed: false, off: true }];
    var kinds = kind === 'edit' ? ['edit', 'upscale'] : [kind];
    var list = S.makers.filter(function (m) { return kinds.indexOf(m.kind) >= 0 && (m.installed || m.wanted || m.loadable); });
    var at = function (m) { return m.installed ? 0 : m.line || (m.wanted ? 98 : 99); };
    return list.map(function (m, i) { return { m: m, i: i }; }).sort(function (a, b) { return at(a.m) - at(b.m) || a.i - b.i; }).map(function (x) { return x.m; });
  }
  function chosenMaker() {
    var list = makersFor();
    return list.filter(function (m) { return m.id === S.maker; })[0] || list.filter(function (m) { return m.installed; })[0] || list[0] || null;
  }
  function makerState(m) {
    if (m.off) return 'when the machine is on';
    if (m.installed) return 'ready';
    if (m.wanted) return (m.percent || 0) + '%' + (m.line > 1 ? ' · ' + nth(m.line) + ' in line' : '');
    return 'tap to load';
  }
  function nth(n) { var t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); }
  function pickMaker(id) {
    S.maker = id;
    save();
    var m = (S.makers || []).filter(function (x) { return x.id === id; })[0];
    if (m && !m.installed && !m.wanted && m.loadable) {
      machine('/_orbit/studio/makers/load', { method: 'POST', body: { id: id, first: false } }).then(function (r) { if (Array.isArray(r.makers)) S.makers = r.makers; draw(); }).catch(function (err) { S.note = err.message; draw(); });
    }
    draw();
  }

  // ---- making it
  function stylesFor(m) { return m ? (S.makers || []).filter(function (x) { return x.kind === 'style' && x['for'] === m.id && x.installed; }) : []; }
  function make(prompt) {
    var m = chosenMaker();
    var k = S.kind;
    var body = { kind: k === 'video' ? 'video' : k === 'model3d' ? 'model3d' : 'image', maker: m ? m.id : DEFAULT[k], prompt: k === 'model3d' ? '' : (prompt || S.prompt).trim() };
    if (k === 'image' || k === 'video') body.size = S.size;
    if (k === 'video') body.seconds = S.seconds;
    if (k === 'image' && S.style && stylesFor(m).some(function (x) { return x.id === S.style; })) body.style = S.style;
    if (photoMode()) {
      var first = S.photos[0];
      if (first && first.item) body.fromItem = first.item;
      var ups = S.photos.filter(function (x) { return !x.item; }).map(function (x) { return x.src; });
      var more = S.photos.slice(1).filter(function (x) { return x.item; }).map(function (x) { return x.item; });
      if (ups.length) body.images = ups.slice(0, 2);
      if (more.length) body.imageItems = more;
    }
    return machine('/_orbit/studio/jobs', { method: 'POST', body: body });
  }
  function ready() {
    if (!on()) { S.note = 'Turn the AI machine on first (the button at the top).'; return false; }
    if (photoMode() && !S.photos.length) { S.note = 'Add a photo first (step 3).'; return false; }
    if (S.kind !== 'model3d' && !S.prompt.trim()) { S.note = 'Describe it first (step 3), or tap Do it for me there.'; return false; }
    return true;
  }
  function makeOne() {
    if (!ready()) { draw(); return; }
    S.busy = 'make'; S.note = ''; draw();
    make().then(function (j) { S.jobs.unshift(j); poll(); }).catch(function (err) { S.note = err.message; }).then(function () { S.busy = ''; draw(); });
  }
  function makeAll() {
    if (!on()) { S.note = 'Turn the AI machine on first (the button at the top).'; draw(); return; }
    var scenes = (S.story && S.story.scenes) || [];
    var i = 0, ok = 0;
    S.busy = 'all'; S.note = ''; draw();
    (function next() {
      if (i >= scenes.length) { S.busy = ''; S.note = ok + ' of ' + scenes.length + ' scenes are in the queue. They land in your gallery as they finish.'; poll(); draw(); return; }
      make(scenes[i++].prompt).then(function (j) { ok++; S.jobs.unshift(j); }, function (err) { S.note = err.message; }).then(function () { draw(); next(); });
    })();
  }
  var timer = null;
  var final = function (j) { return j.status === 'done' || j.status === 'error' || j.status === 'stopped'; };
  function poll() {
    clearTimeout(timer);
    var live = S.jobs.filter(function (j) { return !final(j); });
    if (!live.length) return;
    timer = setTimeout(function () {
      Promise.all(live.map(function (j) { return machine('/_orbit/studio/jobs/' + encodeURIComponent(j.id)).then(function (n) { S.jobs = S.jobs.map(function (x) { return x.id === n.id ? n : x; }); }, function () {}); })).then(function () { draw(); poll(); });
    }, 3000);
  }
  function stop(id) {
    machine('/_orbit/studio/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: {} }).then(function () { S.jobs = S.jobs.map(function (x) { return x.id === id ? Object.assign({}, x, { status: 'stopped' }) : x; }); draw(); }).catch(function (err) { S.note = err.message; draw(); });
  }
  var abs = function (u) { return /^https?:/.test(u) ? u : (S.grant ? S.grant.url : '') + u; };
  function media(it, big) {
    if (!it) return '';
    var url = abs(it.url);
    if (it.kind === 'video') return '<video src="' + esc(url) + '" controls playsinline loop' + (big ? '' : ' preload="metadata"') + '></video>';
    if (it.kind === 'model3d') return (it.poster ? '<img src="' + esc(abs(it.poster)) + '" alt="3D object">' : '') + '<p class="note"><a href="' + esc(url) + '" download>Download the 3D file (.glb)</a></p>';
    return '<img src="' + esc(url) + '" alt="What was made">';
  }
  function jobView() {
    if (!S.jobs.length) return '';
    return S.jobs.slice(0, 8).map(function (j) {
      if (j.status === 'done' && j.item) return '<div class="out">' + media(j.item, true) + '<p class="note">In your gallery too.</p></div>';
      if (j.status === 'error') return '<p class="note bad">' + esc(j.error || 'It did not work.') + '</p>';
      if (j.status === 'stopped') return '<p class="note">Stopped.</p>';
      var where = j.position ? nth(j.position) + ' in line' : j.status === 'running' ? 'Making it…' : 'Waiting…';
      return '<div class="scene"><p>' + esc((j.prompt || NOUN[S.kind] || 'It') .slice(0, 80)) + '</p><p class="note">' + esc(where) + (j.etaSeconds ? ' · about ' + Math.max(1, Math.round(j.etaSeconds / 60)) + ' min' : '') + '</p><div class="prog"><span style="width:' + (j.progress || 0) + '%"></span></div><div class="acts"><button class="btn s" data-stop="' + esc(j.id) + '">Stop</button></div></div>';
    }).join('');
  }

  // ---- photos (your own, shrunk on the phone) and your gallery
  function shrink(file, max) {
    return new Promise(function (ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('That picture could not be read.')); };
      img.src = url;
    });
  }
  function addFile(file) {
    if (!file) return;
    shrink(file, 1920).then(function (src) { S.photos = S.photos.concat([{ src: src }]).slice(0, 2); S.note = ''; draw(); }, function (err) { S.note = err.message; draw(); });
  }
  function loadItems() {
    return machine('/_orbit/studio/items').then(function (r) { S.items = (r.items || []).slice(0, 60); draw(); sheetDraw(); }).catch(function (err) { S.note = err.message; draw(); });
  }
  function gallerySheet() {
    if (!on()) { S.note = 'Turn the AI machine on to see your gallery (it holds your files).'; draw(); return; }
    var box = document.createElement('div'); box.className = 'sheet'; box.id = 'gal';
    box.innerHTML = '<div class="in" role="dialog" aria-label="Your gallery"><p class="kick">Gallery</p><h2>Your gallery</h2><div id="galbody"><p class="note">Loading…</p></div><div class="acts"><button class="btn" data-do="galclose">Close</button></div></div>';
    document.body.appendChild(box);
    S.view = null;
    loadItems();
  }
  function sheetDraw() {
    var b = $('#galbody'); if (!b) return;
    if (S.view) {
      var it = S.view;
      b.innerHTML = '<div class="out">' + media(it, true) + '</div><p class="note">' + esc((it.prompt || '').slice(0, 200)) + '</p><div class="acts">' + (it.kind === 'image' ? '<button class="btn a" data-usepic="' + esc(it.id) + '">Use as my photo</button>' : '') + '<button class="btn" data-do="galback">Back</button></div>';
      return;
    }
    b.innerHTML = !S.items ? '<p class="note">Loading…</p>' : !S.items.length ? '<p class="note">Nothing here yet.</p>' : '<div class="grid">' + S.items.map(function (it) {
      var t = it.thumbUrl || (it.kind === 'image' ? it.url : it.poster || '');
      return '<button class="tile" data-view="' + esc(it.id) + '" aria-label="' + esc((it.prompt || it.kind).slice(0, 60)) + '">' + (t ? '<img loading="lazy" src="' + esc(abs(t)) + '" alt="">' : '<span>' + esc(it.kind) + '</span>') + (it.kind !== 'image' ? '<i>' + (it.kind === 'video' ? '▶' : '3D') + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function usePic(id) {
    var it = (S.items || []).filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    S.photos = S.photos.concat([{ item: it.id, src: abs(it.thumbUrl || it.url) }]).slice(0, 2);
    var g = $('#gal'); if (g) g.remove();
    S.view = null; S.note = ''; draw();
  }

  // ---- "Do it for me" on every step
  function doIt() {
    var step = STEPS[S.step];
    if (step === 'what') { S.kind = S.kind || 'image'; go(1); }
    else if (step === 'maker') { var m = chosenMaker(); if (m) S.maker = m.id; go(2); }
    else if (step === 'describe') { if (S.kind === 'model3d') go(3); else busy('write', doPrompt()); }
    else if (step === 'extras') { if (!S.size) S.size = 'portrait'; go(4); }
    else makeOne();
    save();
  }
  function busy(what, p) {
    S.busy = what; S.note = ''; draw();
    p.catch(function (err) { S.note = err.message; }).then(function () { S.busy = ''; draw(); });
  }

  // ---- the steps
  function chip(attr, val, cur, label) { return '<button class="chip" ' + attr + '="' + esc(val) + '" aria-pressed="' + (String(val) === String(cur)) + '">' + esc(label) + '</button>'; }
  function body(step) {
    if (step === 'what') {
      return '<div class="choices" role="radiogroup" aria-label="What to make">' + KINDS.map(function (k) {
        return '<button class="ch" data-kind="' + k[0] + '" role="radio" aria-checked="' + (S.kind === k[0]) + '" aria-pressed="' + (S.kind === k[0]) + '"><span class="n">' + k[1] + '</span><span class="s">' + k[2] + '</span></button>';
      }).join('') + '</div>';
    }
    if (step === 'maker') {
      var c = chosenMaker();
      var list = makersFor();
      return '<div class="choices" role="radiogroup" aria-label="Maker">' + list.map(function (m) {
        var sel = c && c.id === m.id;
        return '<button class="ch" data-maker="' + esc(m.id) + '" role="radio" aria-checked="' + sel + '" aria-pressed="' + sel + '"><span class="n">' + esc(m.name) + '</span><span class="s">' + esc(makerState(m)) + '</span></button>';
      }).join('') + '</div>' + (S.makers ? '<p class="note">Tap makers that aren’t loaded in the order you want them: each one joins the line.</p>' : '<p class="note">Turn your AI machine on to see every maker.</p>');
    }
    if (step === 'describe') {
      var e = S.eros;
      var story = S.story ? '<div class="story"><h3>' + esc(S.story.title) + '</h3>' + (S.story.characters ? '<p class="note">' + esc(S.story.characters) + '</p>' : '') +
        S.story.scenes.map(function (s, i) { return '<div class="scene"><p>' + esc(s.story) + '</p><p class="pr">' + esc(s.prompt) + '</p><div class="acts"><button class="btn s" data-use="' + i + '">Use this prompt</button></div></div>'; }).join('') +
        '<div class="acts"><button class="btn a" data-do="all"' + (S.busy ? ' disabled' : '') + '>' + (S.busy === 'all' ? 'Sending…' : 'Make all ' + S.story.scenes.length + ' scenes') + '</button></div></div>' : '';
      var writers = S.writers && S.writers.length ? '<label class="f" for="writer">Writer (NVIDIA, unfiltered)</label><select id="writer" class="sel">' +
        '<option value=""' + (S.writer ? '' : ' selected') + '>Automatic \u00b7 the best one answering</option>' +
        S.writers.map(function (id) { return '<option value="' + esc(id) + '"' + (S.writer === id ? ' selected' : '') + '>' + esc(writerName(id)) + '</option>'; }).join('') + '</select>' : '';
      var photos = photoMode() ? '<label class="f">' + (S.kind === 'model3d' ? 'One picture of the thing' : 'Your photo (add a second to combine)') + '</label><div class="row">' + S.photos.map(function (p, i) { return '<span class="thumb"><img src="' + esc(p.src) + '" alt="Your photo ' + (i + 1) + '"><button class="x" data-rmphoto="' + i + '" aria-label="Remove photo ' + (i + 1) + '">×</button></span>'; }).join('') +
        (S.photos.length < (S.kind === 'model3d' ? 1 : 2) ? '<label class="btn s a pick">Add a photo<input type="file" accept="image/*" id="photo" class="hide"></label><button class="btn s" data-do="gal">From your gallery</button>' : '') + '</div>' : '';
      if (S.kind === 'model3d') return photos + '<p class="note">No words needed: it makes the 3D object from the picture. Best with one thing on a plain background.</p>';
      return photos + writers + '<textarea id="prompt" aria-label="Describe it" placeholder="Who, what, where, the light, the mood…">' + esc(S.prompt) + '</textarea>' +
        '<div class="acts"><button class="btn a" data-do="eros" aria-expanded="' + Boolean(S.erosOpen) + '">Eros story writer</button><button class="btn s" data-do="clear">Clear</button></div>' +
        (S.erosOpen ? '<div class="story" aria-label="Eros story writer"><p class="kick">Eros</p><p class="dek">An idea becomes a short adult story, and every scene a prompt. Made-up adults only.</p>' +
          '<label class="f" for="eidea">The idea</label><textarea id="eidea" style="min-height:90px" placeholder="Two strangers stuck in a lift during a blackout…">' + esc(e.idea) + '</textarea>' +
          '<label class="f" for="ewho">Who (optional)</label><input type="text" id="ewho" value="' + esc(e.who) + '" placeholder="a tall bartender in her thirties, a shy architect">' +
          '<label class="f">How hot</label><div class="row" role="group" aria-label="How hot">' + chip('data-heat', 'romantic', e.heat, 'Romantic') + chip('data-heat', 'steamy', e.heat, 'Steamy') + chip('data-heat', 'explicit', e.heat, 'Explicit') + '</div>' +
          '<label class="f">Scenes</label><div class="row" role="group" aria-label="Scenes">' + [3, 5, 8].map(function (n) { return chip('data-scenes', n, e.scenes, String(n)); }).join('') + '</div>' +
          '<div class="acts"><button class="btn p" data-do="story"' + (S.busy ? ' disabled' : '') + '>' + (S.busy === 'story' ? 'Writing…' : 'Write the story') + '</button></div></div>' : '') + story;
    }
    if (step === 'extras') {
      var cm = chosenMaker(), st = S.kind === 'image' ? stylesFor(cm) : [];
      var styleRow = st.length ? '<label class="f">Style</label><div class="row" role="group" aria-label="Style">' + chip('data-style', '', S.style, 'No style') + st.map(function (x) { return chip('data-style', x.id, S.style, x.name); }).join('') + '</div>' : '';
      if (S.kind === 'edit' || S.kind === 'model3d') return '<p class="note">Nothing to set for ' + (S.kind === 'edit' ? 'an edit' : 'a 3D object') + '. Go on to make it.</p>';
      return styleRow + '<label class="f">Shape</label><div class="row" role="group" aria-label="Shape">' + chip('data-size', 'portrait', S.size, 'Portrait') + chip('data-size', 'square', S.size, 'Square') + chip('data-size', 'landscape', S.size, 'Landscape') + '</div>' +
        (S.kind === 'video' ? '<label class="f">Length</label><div class="row" role="group" aria-label="Length">' + chip('data-sec', 5, S.seconds, '5 seconds') + chip('data-sec', 10, S.seconds, '10 seconds') + '</div>' : '');
    }
    var m = chosenMaker();
    return '<ul class="sum"><li><span>What</span><span>' + (S.kind === 'video' ? 'A video, ' + S.seconds + ' s' : 'A ' + NOUN[S.kind]) + '</span></li><li><span>Maker</span><span>' + esc(m ? m.name : '') + '</span></li>' + (S.kind === 'image' || S.kind === 'video' ? '<li><span>Shape</span><span>' + esc(S.size) + '</span></li>' : '<li><span>Photos</span><span>' + S.photos.length + '</span></li>') + '' + (S.kind === 'model3d' ? '' : '<li><span>Words</span><span>' + esc(S.prompt.trim() ? S.prompt.trim().slice(0, 140) + (S.prompt.length > 140 ? '…' : '') : 'none yet') + '</span></li>') + '</ul>' +
      '<div class="acts"><button class="btn p" data-do="make"' + (S.busy ? ' disabled' : '') + '>' + (S.busy === 'make' ? 'Sending…' : 'Make it') + '</button></div>' + jobView();
  }
  function go(i) { S.step = Math.max(0, Math.min(STEPS.length - 1, i)); S.note = ''; draw(); window.scrollTo(0, 0); }
  function draw() {
    var step = STEPS[S.step];
    var label = step === 'describe' && S.busy === 'write' ? 'Writing…' : 'Do it for me';
    $('#dots').innerHTML = STEPS.map(function (s, i) { return '<button data-go="' + i + '"' + (i === S.step ? ' aria-current="step"' : '') + ' aria-label="Step ' + (i + 1) + ' of 5: ' + SHORT[s] + '">' + (i < 9 ? '0' : '') + (i + 1) + (i === S.step ? '&nbsp; ' + esc(SHORT[s].toUpperCase()) : '') + '</button>'; }).join('');
    $('#pane').innerHTML = '<section class="pane"><p class="kick">Step ' + (S.step + 1) + ' of 5</p><h1>' + TITLE[step] + '</h1>' + body(step) +
      (step === 'make' ? '' : '<div class="acts"><button class="btn a" data-do="doit"' + (S.busy ? ' disabled' : '') + '>' + label + '</button></div>') + (S.note ? '<p class="note' + (/not|first|can.t|did not|could not/i.test(S.note) ? ' bad' : '') + '" role="status">' + esc(S.note) + '</p>' : '') + '</section>';
    $('#back').classList.toggle('hide', S.step === 0);
    $('#back').textContent = S.step ? '← ' + SHORT[STEPS[S.step - 1]] : '';
    $('#next').classList.toggle('hide', S.step === STEPS.length - 1);
    $('#next').textContent = S.step < STEPS.length - 1 ? SHORT[STEPS[S.step + 1]] + ' →' : '';
  }

  // ---- taps, typing and swipes
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'back') return go(S.step - 1);
    if (t.id === 'next') return go(S.step + 1);
    if (t.hasAttribute('data-go')) return go(Number(t.getAttribute('data-go')));
    if (t.hasAttribute('data-kind')) { if (S.kind !== t.getAttribute('data-kind')) { S.photos = []; S.style = ''; } S.kind = t.getAttribute('data-kind'); S.maker = ''; save(); return go(1); }
    if (t.hasAttribute('data-maker')) return pickMaker(t.getAttribute('data-maker'));
    if (t.hasAttribute('data-stop')) return stop(t.getAttribute('data-stop'));
    if (t.hasAttribute('data-style')) { S.style = t.getAttribute('data-style'); return draw(); }
    if (t.hasAttribute('data-rmphoto')) { S.photos.splice(Number(t.getAttribute('data-rmphoto')), 1); return draw(); }
    if (t.hasAttribute('data-view')) { S.view = (S.items || []).filter(function (x) { return x.id === t.getAttribute('data-view'); })[0] || null; return sheetDraw(); }
    if (t.hasAttribute('data-usepic')) return usePic(t.getAttribute('data-usepic'));
    if (t.hasAttribute('data-size')) { S.size = t.getAttribute('data-size'); save(); return draw(); }
    if (t.hasAttribute('data-sec')) { S.seconds = Number(t.getAttribute('data-sec')); save(); return draw(); }
    if (t.hasAttribute('data-heat')) { S.eros.heat = t.getAttribute('data-heat'); save(); return draw(); }
    if (t.hasAttribute('data-scenes')) { S.eros.scenes = Number(t.getAttribute('data-scenes')); save(); return draw(); }
    if (t.hasAttribute('data-use')) { S.prompt = S.story.scenes[Number(t.getAttribute('data-use'))].prompt; save(); return go(STEPS.indexOf('describe')); }
    var d = t.getAttribute('data-do');
    if (d === 'doit') return doIt();
    if (d === 'gal') return gallerySheet();
    if (d === 'galclose') { var gg = $('#gal'); if (gg) gg.remove(); return; }
    if (d === 'galback') { S.view = null; return sheetDraw(); }
    if (d === 'power') return power();
    if (d === 'off') return off();
    if (d === 'make') return makeOne();
    if (d === 'all') return makeAll();
    if (d === 'eros') { S.erosOpen = !S.erosOpen; return draw(); }
    if (d === 'story') return busy('story', doStory());
    if (d === 'clear') { S.prompt = ''; save(); return draw(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'photo') { addFile(e.target.files && e.target.files[0]); e.target.value = ''; }
    if (e.target.id === 'writer') { S.writer = e.target.value; save(); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'prompt') S.prompt = e.target.value;
    if (e.target.id === 'eidea') S.eros.idea = e.target.value;
    if (e.target.id === 'ewho') S.eros.who = e.target.value;
    save();
  });
  var sx = null, sy = 0;
  document.addEventListener('touchstart', function (e) { var tag = e.target.tagName; sx = tag === 'TEXTAREA' || tag === 'INPUT' || e.target.closest('.sheet') ? null : e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (sx == null) return;
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(S.step + (dx < 0 ? 1 : -1));
  }, { passive: true });

  draw();
  drawBar();
  refresh();
  loadWriters();
  setInterval(function () { if (!document.hidden) refresh(); }, 15000);
  setInterval(function () { if (!document.hidden && on() && STEPS[S.step] === 'maker') loadMakers(); }, 8000);
})();
`;

/** The whole page: everything in one response, no other file to fetch. */
export function liteMakePage(): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="theme-color" content="#0d0c0b"><meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Make">' +
    '<link rel="apple-touch-icon" href="/apple-icon.png"><title>Make</title>' +
    '<style>' + LITE_CSS + '</style></head><body>' +
    '<div class="wrap"><header class="bar" id="bar" aria-label="AI machine"><span class="st">AI machine…</span></header>' +
    '<nav class="dots" id="dots" aria-label="Make, step by step"></nav><main id="pane"></main></div>' +
    '<div class="nav"><div class="in"><button class="btn back" id="back"></button><span class="grow"></span><button class="btn p next" id="next"></button></div></div>' +
    '<noscript><p style="padding:16px">This page needs JavaScript.</p></noscript>' +
    '<script>' + LITE_JS + '</script></body></html>'
  );
}
