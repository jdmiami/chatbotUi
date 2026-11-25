/**
 * The simple app's other tabs, added to the fast Make page (lib/liteMake.ts) inside its script, so
 * they share its machine bar, its requests and its state: Lab (your prompts multiplied in your style
 * on your AI machine), AI Center (a chat with NVIDIA's open-weight models, and Eros, the adult story
 * writer whose scenes become prompts) and Gallery. Make keeps its five steps.
 *
 * Written without backticks or "${" so it sits inside the page's strings as is.
 */

export const CENTER_CSS = String.raw`
.tabs{display:flex;gap:4px;margin:10px 0 0;overflow-x:auto;scrollbar-width:none}
.tabs a{flex:1 0 auto;text-align:center;color:var(--ink3);text-decoration:none;font:600 13px/1 var(--ui);letter-spacing:.06em;padding:11px 12px;border-radius:999px;min-height:40px}
.tabs a[aria-current=page]{background:#1c1d33;color:var(--ink)}
.msgs{display:flex;flex-direction:column;gap:10px;margin:12px 0}
.msg{padding:12px 14px;border-radius:16px;max-width:92%;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.u{align-self:flex-end;background:#1c1d33}
.msg.a{align-self:flex-start;background:var(--card);border:1px solid var(--line)}
.tile.nsfw img{filter:blur(18px) saturate(.6)}
.lab-q{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px 14px;margin:8px 0 0}
.lab-q p{margin:0 0 6px;overflow-wrap:anywhere}
.lab-q small{color:var(--ink3)}
.seg{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0}
input[type=search]{width:100%;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:12px 16px;font-size:16px;outline:none;-webkit-appearance:none;appearance:none}
input[type=search]:focus{border-color:var(--accent)}
.tile.sel{outline:3px solid var(--accent);outline-offset:-3px}
.tile.sel::after{content:'✓';position:absolute;left:6px;top:6px;width:24px;height:24px;border-radius:50%;background:var(--accent);color:#111;font:700 14px/24px var(--ui)}
.gv .in{max-height:96dvh}
.gv .out img,.gv .out video{max-height:62dvh;object-fit:contain}
.out.nsfw img,.out.nsfw video{filter:blur(24px)}
.pa{position:fixed;inset:0;background:#000;z-index:9;display:flex;flex-direction:column}
.pa video{flex:1;width:100%;min-height:0;object-fit:contain;background:#000}
.pa-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
`;

export const CENTER_JS = String.raw`
  // ---- the simple app: Make (above), Lab, AI Center and Gallery, one tab each
  var TABS = [['make', 'Make'], ['lab', 'Lab'], ['ai', 'AI Center'], ['gallery', 'Gallery']];
  var tabOk = function (t) { return TABS.some(function (x) { return x[0] === t; }); };
  S.tab = (location.hash || '').slice(1);
  if (!tabOk(S.tab)) S.tab = 'make';
  S.chat = [];
  try { S.chat = JSON.parse(localStorage.getItem('orbit.lite.chat') || '[]').slice(-40); } catch (e) {}
  try { S.showNsfw = sessionStorage.getItem('orbit.lite.nsfw') === '1'; } catch (e) {}
  var drawMake = draw;
  draw = function () {
    $('#tabs').innerHTML = TABS.map(function (t) { return '<a href="#' + t[0] + '" data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('');
    var make = S.tab === 'make';
    $('#dots').classList.toggle('hide', !make);
    $('.nav').classList.toggle('hide', !make);
    if (make) return drawMake();
    var html = S.tab === 'lab' ? labPane() : S.tab === 'ai' ? aiPane() : galleryPane();
    $('#pane').innerHTML = '<section class="pane">' + html + (S.note ? '<p class="note" role="status">' + esc(S.note) + '</p>' : '') + '</section>';
    var log = $('#msgs'); if (log && S.chatBusy) log.lastElementChild && log.lastElementChild.scrollIntoView({ block: 'end' });
    if (S.tab === 'gallery') watchMore();
  };
  function tab(t) {
    if (!tabOk(t)) t = 'make';
    S.tab = t; S.note = '';
    try { history.replaceState(null, '', t === 'make' ? location.pathname : '#' + t); } catch (e) {}
    draw(); window.scrollTo(0, 0);
    if (t === 'lab') loadLab();
    if (t === 'gallery') galleryLoad();
  }
  var needOn = function (what) { return '<p class="dek">' + what + ' needs your AI machine on. Turn it on with the button at the top.</p>'; };
  var blurred = function (it) { return !S.showNsfw && (it.nsfwUser === true || (it.nsfw === true && it.nsfwUser !== false)); };
  function tiles(list, attr) {
    return '<div class="grid">' + list.map(function (it) {
      var t = it.thumbUrl || (it.kind === 'image' ? it.url : it.poster || '');
      return '<button class="tile' + (blurred(it) ? ' nsfw' : '') + '" ' + attr + '="' + esc(it.id) + '" aria-label="' + esc((it.prompt || it.kind || '').slice(0, 60)) + '">' + (t ? '<img loading="lazy" src="' + esc(abs(t)) + '" alt="">' : '<span>' + esc(it.kind) + '</span>') + (it.kind === 'video' ? '<i>▶</i>' : '') + '</button>';
    }).join('') + '</div>';
  }
  var nsfwChip = function () { return '<button class="chip" data-do="nsfw" aria-pressed="' + Boolean(S.showNsfw) + '">Show NSFW</button>'; };

  // ---- Lab: the writer keeps writing new prompts in your style; your machine makes them
  // Someone typing in the page: a refresh in the background waits, so the keyboard stays put.
  var typing = function () { var a = document.activeElement; return Boolean(a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.closest('#pane')); };
  function loadLab() {
    if (!on()) { S.lab = null; return; }
    return machine('/_orbit/studio/lab').then(function (r) { S.lab = r; S.labErr = ''; if (S.tab === 'lab' && !typing()) draw(); }).catch(function (err) {
      S.labErr = /404/.test(err.message) || /not available/i.test(err.message) ? 'Your AI machine is on an older version. The new Lab arrives the next time it starts.' : err.message;
      if (S.tab === 'lab') draw();
    });
  }
  function labDo(path, body, method, what) {
    S.busy = what || 'lab'; draw();
    return machine('/_orbit/studio/lab' + path, { method: method || 'POST', body: body || {} }).then(function (r) { S.lab = r; S.labErr = ''; }).catch(function (err) { S.labErr = err.message; }).then(function () { S.busy = ''; draw(); });
  }
  function multiply(prompt, count) {
    if (!on()) { S.note = 'Turn the AI machine on first (the button at the top).'; return draw(); }
    S.tab = 'lab';
    try { history.replaceState(null, '', '#lab'); } catch (e) {}
    return labDo('/queue', { prompt: prompt, count: count || 6 }, 'POST', 'multiply');
  }
  function labPane() {
    var head = '<p class="kick">Lab</p><h1>Your prompts, multiplied</h1><p class="dek">It runs on its own while your machine is on: the writer reads the prompts you wrote in Make and keeps writing new ones in the same style, and your machine makes them with the maker you used last. It steps aside whenever you make something, then carries on.</p>';
    if (!on()) return head + needOn('The Lab');
    var L = S.lab;
    if (!L) return head + (S.labErr ? '<p class="note bad">' + esc(S.labErr) + '</p>' : '<p class="note">Opening the Lab…</p>');
    var y = L.yours || { pictures: 0, videos: 0 };
    var none = !(y.pictures + y.videos);
    var making = L.making ? '<div class="scene" role="status" aria-label="Making now"><p>' + esc(L.making.prompt) + '</p><p class="note">' + (L.making.kind === 'clip' ? '5-second video' : 'Picture') + (L.making.job ? ' · ' + (L.making.job.status === 'queued' ? 'waiting for the maker' : Math.round(L.making.job.progress || 0) + '%') : '') + '</p><div class="prog"><span style="width:' + ((L.making.job && L.making.job.progress) || 0) + '%"></span></div><div class="acts"><button class="btn s" data-do="labskip">Skip</button></div></div>'
      : '<p class="note">' + (L.writing ? 'Writing new prompts in your style…' : L.enabled ? 'The next one starts as soon as the machine is free.' : 'The Lab is off.') + ' ' + (L.madeLastHour || 0) + ' made in the last hour.</p>';
    var queue = (L.queue || []).map(function (q, i) {
      return '<div class="lab-q"><p>' + esc(q.prompt) + '</p><small>' + (q.kind === 'clip' ? '5-second video' : 'Picture') + (q.from ? ' · from your prompt' : ' · in your style') + '</small><div class="acts">' + (i ? '<button class="btn s" data-labnext="' + esc(q.id) + '">Make next</button>' : '') + '<button class="btn s" data-labdrop="' + esc(q.id) + '">Drop</button></div></div>';
    }).join('');
    var made = (L.records || []).filter(function (r) { return r && r.id; });
    return head +
      '<div class="row"><button class="chip" data-do="labpower" aria-pressed="' + Boolean(L.enabled) + '">' + (L.enabled ? 'On: making new ones' : 'Off: tap to start') + '</button></div>' +
      '<div class="seg" role="group" aria-label="What the Lab makes">' + [['both', 'Both'], ['pictures', 'Pictures'], ['videos', 'Videos']].map(function (m) { return chip('data-labmix', m[0], L.mix || 'videos', m[1]); }).join('') + '</div>' +
      '<p class="note" data-testid="lab-yours">' + (none ? 'Make a few pictures or videos in Make first: the Lab writes in the style of your own prompts.' : 'Learning from ' + y.pictures + ' picture and ' + y.videos + ' video prompts of yours.') + '</p>' +
      (L.makers ? '<p class="note" data-testid="lab-makers">' + esc(labMakers(L)) + '</p>' : '') +
      (S.labErr || L.lastError ? '<p class="note bad">' + esc(S.labErr || ('Last try: ' + L.lastError)) + '</p>' : '') +
      '<label class="f" for="labseed">Multiply one prompt</label><textarea id="labseed" style="min-height:80px" placeholder="Paste one of your prompts: 6 new ones are written from it">' + esc(S.labSeed || '') + '</textarea>' +
      '<div class="acts"><button class="btn p" data-do="labmul"' + (S.busy === 'multiply' ? ' disabled' : '') + '>' + (S.busy === 'multiply' ? 'Writing…' : 'Multiply') + '</button><button class="btn a" data-do="labwrite"' + (S.busy || none ? ' disabled' : '') + '>' + (S.busy === 'labwrite' ? 'Writing…' : 'Write new ones') + '</button></div>' +
      '<p class="kick">Making now</p>' + making +
      '<p class="kick">Up next' + ((L.queue || []).length ? ' · ' + L.queue.length : '') + '</p>' + (queue || '<p class="note">The writer adds the next prompts here a moment before they are needed.</p>') +
      '<p class="kick">Made in the Lab</p>' + (made.length ? '<div class="row">' + nsfwChip() + '</div><div style="height:8px"></div>' + tiles(made, 'data-labview') : '<p class="note">What the Lab makes shows up here. Keep the ones you like: they move to your gallery.</p>');
  }
  function labMakers(L) {
    var m = L.makers || {}, mix = L.mix || 'videos', parts = [];
    if (mix !== 'pictures') parts.push(m.clip ? 'videos with ' + m.clip.name : 'no video maker loaded');
    if (mix !== 'videos') parts.push(m.picture ? 'pictures with ' + m.picture.name : 'no picture maker loaded');
    return 'Making ' + parts.join(' and ') + ': the makers you used last in Make, already loaded.';
  }
  function labViewer(id) {
    var r = ((S.lab && S.lab.records) || []).filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var box = document.createElement('div'); box.className = 'sheet'; box.id = 'labv';
    box.innerHTML = '<div class="in" role="dialog" aria-label="Made in the Lab"><div class="out">' + media(r, true) + '</div><p class="note">' + esc(r.prompt || '') + '</p>' +
      '<div class="acts"><button class="btn p" data-labkeep="' + esc(r.id) + '">Keep in my gallery</button><button class="btn a" data-labmore="' + esc(r.id) + '">More like this</button><button class="btn" data-labdel="' + esc(r.id) + '">Delete</button><button class="btn" data-do="labclose">Close</button></div></div>';
    document.body.appendChild(box);
  }
  var closeLabViewer = function () { var b = $('#labv'); if (b) b.remove(); };

  // ---- AI Center: a chat with NVIDIA's open-weight models, and Eros
  function saveChat() { try { localStorage.setItem('orbit.lite.chat', JSON.stringify(S.chat.slice(-40))); } catch (e) {} }
  function aiPane() {
    var msgs = S.chat.length ? S.chat.map(function (m) { return '<div class="msg ' + (m.role === 'user' ? 'u' : 'a') + '">' + esc(m.content || (S.chatBusy ? '…' : '')) + '</div>'; }).join('') : '<p class="note">Ask anything. Answers come from NVIDIA’s open-weight models.</p>';
    var e = S.eros;
    var maker = chosenMaker();
    return '<p class="kick">AI Center</p><h1>Talk and create</h1>' +
      '<p class="kick">Chat</p><div class="msgs" id="msgs" aria-live="polite">' + msgs + '</div>' +
      '<textarea id="chatin" style="min-height:70px" aria-label="Message" placeholder="Message…">' + esc(S.chatDraft || '') + '</textarea>' +
      '<div class="acts"><button class="btn p" data-do="send"' + (S.chatBusy ? ' disabled' : '') + '>' + (S.chatBusy ? 'Answering…' : 'Send') + '</button>' + (S.chat.length ? '<button class="btn s" data-do="newchat">New chat</button>' : '') + '</div>' +
      '<div class="story" aria-label="Eros"><p class="kick">Eros creation</p><p class="dek">An idea becomes a short adult story, and every scene a prompt for your ' + esc(NOUN[S.kind] || 'picture') + ' maker' + (maker ? ' (' + esc(maker.name) + ')' : '') + '. Change what it makes in Make. Made-up adults only.</p>' +
      '<label class="f" for="eidea">The idea</label><textarea id="eidea" style="min-height:90px" placeholder="Two strangers stuck in a lift during a blackout…">' + esc(e.idea) + '</textarea>' +
      '<label class="f" for="ewho">Who (optional)</label><input type="text" id="ewho" value="' + esc(e.who) + '" placeholder="a tall bartender in her thirties, a shy architect">' +
      '<label class="f">How hot</label><div class="row" role="group" aria-label="How hot">' + chip('data-heat', 'romantic', e.heat, 'Romantic') + chip('data-heat', 'steamy', e.heat, 'Steamy') + chip('data-heat', 'explicit', e.heat, 'Explicit') + '</div>' +
      '<label class="f">Scenes</label><div class="row" role="group" aria-label="Scenes">' + [3, 5, 8].map(function (n) { return chip('data-scenes', n, e.scenes, String(n)); }).join('') + '</div>' +
      '<div class="acts"><button class="btn p" data-do="story"' + (S.busy ? ' disabled' : '') + '>' + (S.busy === 'story' ? 'Writing…' : 'Write the story') + '</button></div></div>' +
      (S.story && !S.story.batch ? storyHtml(true) : '') + (S.tab === 'ai' && S.jobs.length ? '<p class="kick">Being made</p>' + jobView() : '');
  }
  function sendChat() {
    var box = $('#chatin');
    var text = ((box && box.value) || S.chatDraft || '').trim();
    if (!text || S.chatBusy) return;
    S.chatDraft = '';
    S.chat.push({ role: 'user', content: text });
    var reply = { role: 'assistant', content: '' };
    S.chat.push(reply);
    S.chatBusy = true; draw();
    var history = S.chat.slice(0, -1).slice(-20).map(function (m) { return { role: m.role, content: m.content }; });
    fetch('/api/orb/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ task: 'chat', stream: true, max_tokens: 2048, messages: [{ role: 'system', content: 'You are a helpful assistant in the owner’s private app. Answer plainly and briefly unless asked for more.' }].concat(history) }) }).then(function (r) {
      if (r.status === 401) { location.href = '/login?next=/lite'; throw new Error('Sign in again.'); }
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (b) { throw new Error(b.error || ('The AI answered ' + r.status + '.')); });
      if (!r.body || !r.body.getReader) return r.text().then(function (t) { reply.content = parseSse(t); });
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      return (function pump() {
        return reader.read().then(function (x) {
          if (x.done) return;
          buf += dec.decode(x.value, { stream: true });
          var cut = buf.lastIndexOf('\n');
          if (cut >= 0) { reply.content += parseSse(buf.slice(0, cut)); buf = buf.slice(cut + 1); draw(); }
          return pump();
        });
      })().then(function () { if (buf) reply.content += parseSse(buf); });
    }).catch(function (err) { reply.content = reply.content || ('Could not answer: ' + err.message); }).then(function () {
      reply.content = reply.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || 'No answer came back. Try again.';
      S.chatBusy = false; saveChat(); draw();
    });
  }
  function parseSse(text) {
    var out = '';
    String(text).split('\n').forEach(function (line) {
      if (line.indexOf('data:') !== 0) return;
      var d = line.slice(5).trim();
      if (!d || d === '[DONE]') return;
      try { var j = JSON.parse(d); var c = j.choices && j.choices[0]; out += (c && ((c.delta && c.delta.content) || (c.message && c.message.content))) || ''; } catch (e) {}
    });
    return out;
  }

  // ---- Gallery: everything you made, from cloud storage and (when it is on) the machine and the Lab
  var GKINDS = [['all', 'All'], ['image', 'Pictures'], ['video', 'Videos'], ['lab', 'Lab']];
  S.gk = 'all'; S.gsort = 'new'; S.gq = ''; S.glimit = 90; S.gsel = null; S.gal = null;
  function galleryLoad() {
    var none = function () { return { items: [] }; };
    var parts = [on() ? machine('/_orbit/studio/items').catch(none) : Promise.resolve({ items: [] }),
      on() ? machine('/_orbit/studio/lab').then(function (r) { S.lab = r; return { items: (r.records || []).map(function (x) { return Object.assign({}, x, { lab: true }); }) }; }).catch(none) : Promise.resolve({ items: [] }),
      api('/api/gallery').catch(none)];
    return Promise.all(parts).then(function (rs) {
      var seen = {}, out = [];
      rs.forEach(function (r, i) {
        (r.items || []).forEach(function (it) {
          if (!it || !it.id || seen[it.id] || (!it.url && !it.thumbUrl)) return;
          seen[it.id] = 1;
          out.push(Object.assign({}, it, { onMachine: i < 2 }));
        });
      });
      out.sort(function (x, y) { return String(y.createdAt || '').localeCompare(String(x.createdAt || '')); });
      S.gal = out; S.items = out.filter(function (x) { return !x.lab; });
      if (S.tab === 'gallery') draw();
    });
  }
  function galleryList() {
    var words = S.gq.toLowerCase().split(/\s+/).filter(Boolean);
    var list = (S.gal || []).filter(function (it) {
      if (S.gk === 'lab' ? !it.lab : S.gk !== 'all' && it.kind !== S.gk) return false;
      var text = ((it.prompt || '') + ' ' + (it.title || '') + ' ' + (it.maker || '')).toLowerCase();
      return words.every(function (w) { return text.indexOf(w) >= 0; });
    });
    return S.gsort === 'old' ? list.slice().reverse() : list;
  }
  function gridHtml() {
    var list = galleryList();
    if (!list.length) return '<p class="note">' + (S.gq.trim() ? 'Nothing matches “' + esc(S.gq.trim()) + '”.' : (S.gal || []).length ? 'Nothing of this kind yet.' : 'Nothing here yet. What you make lands here.') + '</p>';
    var shown = list.slice(0, S.glimit);
    return '<p class="note">' + list.length + (list.length === 1 ? ' creation' : ' creations') + '</p><div class="grid" aria-label="Your creations">' + shown.map(function (it) {
      var t = it.thumbUrl || (it.kind === 'image' ? it.url : it.poster || '');
      var sel = S.gsel && S.gsel[it.id];
      return '<button class="tile' + (blurred(it) ? ' nsfw' : '') + (sel ? ' sel' : '') + '" data-gview="' + esc(it.id) + '"' + (S.gsel ? ' aria-pressed="' + Boolean(sel) + '"' : '') + ' aria-label="' + esc((it.prompt || it.kind || '').slice(0, 60)) + '">' + (t ? '<img loading="lazy" src="' + esc(abs(t)) + '" alt="">' : '<span>' + esc(it.kind) + '</span>') + (it.kind === 'video' ? '<i>▶</i>' : it.kind === 'model3d' ? '<i>3D</i>' : it.lab ? '<i>Lab</i>' : '') + '</button>';
    }).join('') + '</div>' + (list.length > shown.length ? '<div class="acts" id="gmore"><button class="btn s" data-do="gmore">Show more (' + (list.length - shown.length) + ')</button></div>' : '');
  }
  function galleryPane() {
    var videos = galleryList().filter(function (it) { return it.kind === 'video' && !blurred(it); }).length;
    var head = '<p class="kick">Gallery</p><h1>Your gallery</h1>' +
      '<input type="search" id="gq" value="' + esc(S.gq) + '" placeholder="Search your prompts" aria-label="Search your prompts" autocomplete="off" enterkeyhint="search">' +
      '<div class="seg" role="group" aria-label="Show">' + GKINDS.map(function (k) { return chip('data-gk', k[0], S.gk, k[1]); }).join('') + '</div>' +
      '<div class="seg" role="group" aria-label="Sort">' + chip('data-gsort', 'new', S.gsort, 'Newest') + chip('data-gsort', 'old', S.gsort, 'Oldest') + '</div>' +
      '<div class="row" style="margin:10px 0 12px">' + nsfwChip() + (videos ? '<button class="btn s a" data-do="playall">Play all videos</button>' : '') +
      (S.gsel ? '<button class="btn s" data-do="gseldel"' + (Object.keys(S.gsel).length ? '' : ' disabled') + '>Delete ' + Object.keys(S.gsel).length + '</button><button class="btn s" data-do="gselend">Done</button>' : '<button class="btn s" data-do="gselect">Select</button>') +
      '<button class="btn s" data-do="galreload">Refresh</button></div>';
    if (!S.gal) return head + '<p class="note">Loading…</p>';
    return head + '<div id="ggrid">' + gridHtml() + '</div>' + (on() ? '' : '<p class="note">Your machine is off: this is the copy kept in cloud storage.</p>');
  }
  function watchMore() {
    var m = $('#gmore');
    if (!m || typeof IntersectionObserver === 'undefined') return;
    var io = new IntersectionObserver(function (seen) { if (seen.some(function (x) { return x.isIntersecting; })) { io.disconnect(); S.glimit += 90; regrid(); } }, { rootMargin: '600px 0px' });
    io.observe(m);
  }
  function regrid() { var g = $('#ggrid'); if (g) { g.innerHTML = gridHtml(); watchMore(); } }
  var galItem = function (id) { return (S.gal || []).filter(function (x) { return x.id === id; })[0] || null; };
  function galleryViewer(id) {
    var it = galItem(id); if (!it) return;
    S.gv = id;
    var box = $('#gv') || document.createElement('div');
    box.className = 'sheet gv'; box.id = 'gv';
    var list = galleryList(), i = list.indexOf(it);
    var act = function (attr, label, cls) { return '<button class="btn s' + (cls ? ' ' + cls : '') + '" ' + attr + '="' + esc(it.id) + '">' + label + '</button>'; };
    var acts = (it.prompt && it.kind !== 'model3d' ? act('data-guse', 'Use prompt') : '') +
      (on() && !it.lab && it.kind === 'image' ? act('data-usepic', 'Use as my photo') : '') +
      (on() && !it.lab && it.kind === 'video' ? act('data-usevid', 'Work on this video') : '') +
      (on() && it.kind === 'model3d' && !it.rigged && rigHere() ? act('data-rig', 'Rig it') : '') +
      (on() && it.prompt && (it.kind === 'image' || it.kind === 'video') ? act('data-gmore', 'More like this', 'a') : '') +
      (it.lab ? act('data-gkeep', 'Keep in my gallery', 'p') : '') +
      '<a class="btn s" href="' + esc(it.downloadUrl || abs(it.url)) + '" download>Save</a>' + act('data-gdel', 'Delete');
    box.innerHTML = '<div class="in" role="dialog" aria-label="Your gallery"><div class="out' + (blurred(it) ? ' nsfw' : '') + '">' + media(it, true) + '</div>' +
      '<p class="note">' + esc(it.prompt || '') + '</p><p class="note">' + esc([it.lab ? 'Lab' : '', it.maker || '', it.createdAt ? new Date(it.createdAt).toLocaleString() : ''].filter(Boolean).join(' · ')) + (i >= 0 ? ' · ' + (i + 1) + ' of ' + list.length : '') + '</p>' +
      '<div class="acts">' + acts + '</div><div class="acts"><button class="btn s" data-do="gprev"' + (i > 0 ? '' : ' disabled') + '>← Previous</button><button class="btn s" data-do="gnext"' + (i >= 0 && i < list.length - 1 ? '' : ' disabled') + '>Next →</button><button class="btn s" data-do="gclose">Close</button></div></div>';
    if (!box.parentNode) document.body.appendChild(box);
  }
  function stepViewer(d) {
    var list = galleryList(), it = galItem(S.gv), i = list.indexOf(it);
    if (i >= 0 && list[i + d]) galleryViewer(list[i + d].id);
  }
  var closeViewer = function () { var b = $('#gv'); if (b) b.remove(); S.gv = null; };
  function removeItem(it) {
    var site = function () { return api('/api/gallery', { method: 'POST', body: { action: 'delete', id: it.id } }); };
    if (it.lab) return on() ? machine('/_orbit/studio/lab/' + encodeURIComponent(it.id), { method: 'DELETE' }).catch(site) : site();
    return on() ? machine('/_orbit/studio/items/' + encodeURIComponent(it.id), { method: 'DELETE' }).catch(site) : site();
  }
  function keepItem(it) {
    return on() ? machine('/_orbit/studio/lab/' + encodeURIComponent(it.id) + '/keep', { method: 'POST', body: {} }) : api('/api/gallery', { method: 'POST', body: { action: 'keep', id: it.id } });
  }
  function afterChange(p, ids) {
    S.busy = 'gal';
    return p.then(function () {
      S.gal = (S.gal || []).filter(function (x) { return ids.indexOf(x.id) < 0; });
    }, function (err) { S.note = err.message; }).then(function () { S.busy = ''; draw(); return galleryLoad(); });
  }
  // Play all: the videos shown, one after another, with only Pause and Exit.
  function playAll() {
    var list = galleryList().filter(function (it) { return it.kind === 'video' && !blurred(it); });
    if (!list.length) return;
    var i = 0, box = document.createElement('div');
    box.className = 'pa'; box.id = 'pa';
    box.innerHTML = '<video playsinline autoplay></video><div class="pa-bar"><button class="btn s" data-do="papause">Pause</button><span class="note" id="pan"></span><button class="btn s" data-do="paexit">Exit</button></div>';
    document.body.appendChild(box);
    var v = box.querySelector('video'), n = box.querySelector('#pan'), bad = 0;
    var go = function () {
      if (!box.isConnected) return;
      v.src = abs(list[i].url); n.textContent = (i + 1) + ' of ' + list.length;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    };
    v.addEventListener('playing', function () { bad = 0; });
    v.addEventListener('ended', function () { i = (i + 1) % list.length; go(); });
    // One that will not play is skipped; when none will, it says so instead of trying forever.
    v.addEventListener('error', function () {
      if (!box.isConnected || !v.getAttribute('src')) return;
      if (++bad >= list.length) { n.textContent = 'These videos will not play right now.'; return; }
      i = (i + 1) % list.length; go();
    });
    go();
  }

  document.addEventListener('click', function (e) {
    // A blurred picture or video in the viewer: a tap shows it.
    var bl = e.target.closest('#gv .out.nsfw');
    if (bl) { bl.classList.remove('nsfw'); return; }
    var a = e.target.closest('a[data-tab]');
    if (a) { e.preventDefault(); return tab(a.getAttribute('data-tab')); }
    var t = e.target.closest('button');
    if (!t) return;
    var d = t.getAttribute('data-do');
    if (d === 'nsfw') { S.showNsfw = !S.showNsfw; try { sessionStorage.setItem('orbit.lite.nsfw', S.showNsfw ? '1' : '0'); } catch (x) {} return draw(); }
    if (d === 'labpower') return labDo('', { enabled: !(S.lab && S.lab.enabled) });
    if (d === 'labskip') return labDo('/cancel');
    if (d === 'labwrite') return labDo('/write', {}, 'POST', 'labwrite');
    if (d === 'labmul') { var p = ($('#labseed') && $('#labseed').value.trim()) || ''; if (!p) { S.labErr = 'Paste a prompt to multiply first.'; return draw(); } S.labSeed = ''; return multiply(p); }
    if (d === 'labclose') return closeLabViewer();
    if (d === 'send') return sendChat();
    if (d === 'newchat') { S.chat = []; saveChat(); return draw(); }
    if (d === 'galreload') { S.gal = null; draw(); return galleryLoad(); }
    if (d === 'gmore') { S.glimit += 90; return regrid(); }
    if (d === 'gselect') { S.gsel = {}; return draw(); }
    if (d === 'gselend') { S.gsel = null; return draw(); }
    if (d === 'gseldel') { var ids = Object.keys(S.gsel || {}); if (!ids.length || !confirm('Delete ' + ids.length + (ids.length === 1 ? ' creation' : ' creations') + '? This cannot be undone.')) return; S.gsel = null; return afterChange(ids.reduce(function (p, id) { var x = galItem(id); return x ? p.then(function () { return removeItem(x); }) : p; }, Promise.resolve()), ids); }
    if (d === 'gprev') return stepViewer(-1);
    if (d === 'gnext') return stepViewer(1);
    if (d === 'gclose') return closeViewer();
    if (d === 'playall') return playAll();
    if (d === 'papause') { var pv = $('#pa video'); if (pv.paused) { pv.play(); t.textContent = 'Pause'; } else { pv.pause(); t.textContent = 'Play'; } return; }
    if (d === 'paexit') { var pa = $('#pa'); if (pa) { var pv2 = pa.querySelector('video'); pv2.pause(); pv2.removeAttribute('src'); pa.remove(); } return; }
    if (t.hasAttribute('data-gk')) { S.gk = t.getAttribute('data-gk'); S.glimit = 90; return draw(); }
    if (t.hasAttribute('data-gsort')) { S.gsort = t.getAttribute('data-gsort'); S.glimit = 90; return draw(); }
    if (t.hasAttribute('data-guse')) { var gu = galItem(t.getAttribute('data-guse')); closeViewer(); S.prompt = gu.prompt; save(); tab('make'); return go(STEPS.indexOf('describe')); }
    if (t.hasAttribute('data-gkeep')) { var gk = galItem(t.getAttribute('data-gkeep')); closeViewer(); return afterChange(keepItem(gk), []); }
    if (t.hasAttribute('data-gdel')) { var gd = galItem(t.getAttribute('data-gdel')); if (!confirm('Delete this? It is removed from your gallery for all your devices.')) return; closeViewer(); return afterChange(removeItem(gd), [gd.id]); }
    if (t.hasAttribute('data-labmix')) return labDo('', { mix: t.getAttribute('data-labmix') });
    if (t.hasAttribute('data-labnext')) return labDo('/queue/' + encodeURIComponent(t.getAttribute('data-labnext')) + '/next');
    if (t.hasAttribute('data-labdrop')) return labDo('/queue/' + encodeURIComponent(t.getAttribute('data-labdrop')), null, 'DELETE');
    if (t.hasAttribute('data-labview')) return labViewer(t.getAttribute('data-labview'));
    if (t.hasAttribute('data-labkeep')) { closeLabViewer(); return labDo('/' + encodeURIComponent(t.getAttribute('data-labkeep')) + '/keep'); }
    if (t.hasAttribute('data-labdel')) { if (!confirm('Delete this from the Lab?')) return; closeLabViewer(); return labDo('/' + encodeURIComponent(t.getAttribute('data-labdel')), null, 'DELETE'); }
    if (t.hasAttribute('data-labmore')) { var r = ((S.lab && S.lab.records) || []).filter(function (x) { return x.id === t.getAttribute('data-labmore'); })[0]; closeLabViewer(); return r && multiply(r.prompt); }
    if (t.hasAttribute('data-rig')) return closeViewer();
    if (t.hasAttribute('data-gview')) {
      var gid = t.getAttribute('data-gview');
      if (S.gsel) { if (S.gsel[gid]) delete S.gsel[gid]; else S.gsel[gid] = 1; return draw(); }
      return galleryViewer(gid);
    }
    if (t.hasAttribute('data-gmore')) { var it = galItem(t.getAttribute('data-gmore')); closeViewer(); return it && multiply(it.prompt); }
    if (t.hasAttribute('data-smore')) { var sc = S.story && S.story.scenes[Number(t.getAttribute('data-smore'))]; return sc && multiply(sc.prompt, 4); }
    // Using a picture or video from the gallery tab carries on in Make.
    if ((t.hasAttribute('data-usepic') || t.hasAttribute('data-usevid') || t.hasAttribute('data-use')) && S.tab !== 'make') {
      closeViewer();
      var step = t.hasAttribute('data-usevid') ? S.step : STEPS.indexOf('describe');
      tab('make');
      return go(step);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'chatin') S.chatDraft = e.target.value;
    if (e.target.id === 'labseed') S.labSeed = e.target.value;
    if (e.target.id === 'gq') { S.gq = e.target.value; S.glimit = 90; regrid(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'chatin' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
  });
  var vx = null, vy = 0;
  document.addEventListener('touchstart', function (e) { vx = e.target.closest('#gv') && !e.target.closest('video') ? e.touches[0].clientX : null; vy = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (vx == null) return;
    var dx = e.changedTouches[0].clientX - vx, dy = e.changedTouches[0].clientY - vy;
    vx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepViewer(dx < 0 ? 1 : -1);
  }, { passive: true });
  window.addEventListener('hashchange', function () { var h = (location.hash || '').slice(1); if (tabOk(h) && h !== S.tab) tab(h); });
  setInterval(function () { if (!document.hidden && S.tab === 'lab' && on() && !S.busy) loadLab(); }, 8000);
  // The machine just came on: the open tab fills in with what is on it.
  var setStatusMake = setStatus;
  setStatus = function (st) {
    var was = on();
    setStatusMake(st);
    if (!was && on()) { if (S.tab === 'gallery') galleryLoad(); if (S.tab === 'lab') loadLab(); }
  };
  if (S.tab === 'gallery') galleryLoad();
`;
