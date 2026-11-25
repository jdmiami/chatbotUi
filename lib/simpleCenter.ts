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
  };
  function tab(t) {
    if (!tabOk(t)) t = 'make';
    S.tab = t; S.note = '';
    try { history.replaceState(null, '', t === 'make' ? location.pathname : '#' + t); } catch (e) {}
    draw(); window.scrollTo(0, 0);
    if (t === 'lab') loadLab();
    if (t === 'gallery') { S.items = null; loadItems(); }
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
  function loadLab() {
    if (!on()) { S.lab = null; return; }
    return machine('/_orbit/studio/lab').then(function (r) { S.lab = r; S.labErr = ''; if (S.tab === 'lab') draw(); }).catch(function (err) {
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
      '<div class="acts"><button class="btn p" data-do="labmul"' + (S.busy ? ' disabled' : '') + '>' + (S.busy === 'multiply' ? 'Writing…' : 'Multiply') + '</button><button class="btn a" data-do="labwrite"' + (S.busy || none ? ' disabled' : '') + '>' + (S.busy === 'labwrite' ? 'Writing…' : 'Write new ones') + '</button></div>' +
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

  // ---- Gallery: everything you made (from cloud storage while the machine is off)
  function galleryPane() {
    var head = '<p class="kick">Gallery</p><h1>Your gallery</h1><div class="row">' + nsfwChip() + '<button class="btn s" data-do="galreload">Refresh</button></div><div style="height:12px"></div>';
    if (!S.items) return head + '<p class="note">Loading…</p>';
    if (!S.items.length) return head + '<p class="note">Nothing here yet. What you make lands here.</p>';
    return head + tiles(S.items, 'data-gview') + (on() ? '' : '<p class="note">Your machine is off: this is the copy kept in cloud storage.</p>');
  }
  function galleryViewer(id) {
    S.galPick = '';
    var box = document.createElement('div'); box.className = 'sheet'; box.id = 'gal';
    box.innerHTML = '<div class="in" role="dialog" aria-label="Your gallery"><div id="galbody"></div></div>';
    document.body.appendChild(box);
    S.view = (S.items || []).filter(function (x) { return x.id === id; })[0] || null;
    sheetDraw();
    var acts = $('#galbody .acts');
    if (acts && S.view && S.view.prompt && on() && (S.view.kind === 'image' || S.view.kind === 'video')) acts.insertAdjacentHTML('afterbegin', '<button class="btn a" data-gmore="' + esc(S.view.id) + '">More like this</button>');
    if (acts) acts.insertAdjacentHTML('beforeend', '<button class="btn" data-do="galclose">Close</button>');
  }

  document.addEventListener('click', function (e) {
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
    if (d === 'galreload') { S.items = null; draw(); return loadItems(); }
    if (t.hasAttribute('data-labmix')) return labDo('', { mix: t.getAttribute('data-labmix') });
    if (t.hasAttribute('data-labnext')) return labDo('/queue/' + encodeURIComponent(t.getAttribute('data-labnext')) + '/next');
    if (t.hasAttribute('data-labdrop')) return labDo('/queue/' + encodeURIComponent(t.getAttribute('data-labdrop')), null, 'DELETE');
    if (t.hasAttribute('data-labview')) return labViewer(t.getAttribute('data-labview'));
    if (t.hasAttribute('data-labkeep')) { closeLabViewer(); return labDo('/' + encodeURIComponent(t.getAttribute('data-labkeep')) + '/keep'); }
    if (t.hasAttribute('data-labdel')) { if (!confirm('Delete this from the Lab?')) return; closeLabViewer(); return labDo('/' + encodeURIComponent(t.getAttribute('data-labdel')), null, 'DELETE'); }
    if (t.hasAttribute('data-labmore')) { var r = ((S.lab && S.lab.records) || []).filter(function (x) { return x.id === t.getAttribute('data-labmore'); })[0]; closeLabViewer(); return r && multiply(r.prompt); }
    if (t.hasAttribute('data-gview')) return galleryViewer(t.getAttribute('data-gview'));
    if (t.hasAttribute('data-gmore')) { var it = (S.items || []).filter(function (x) { return x.id === t.getAttribute('data-gmore'); })[0]; var g = $('#gal'); if (g) g.remove(); return it && multiply(it.prompt); }
    if (t.hasAttribute('data-smore')) { var sc = S.story && S.story.scenes[Number(t.getAttribute('data-smore'))]; return sc && multiply(sc.prompt, 4); }
    // Using a picture or video from the gallery tab carries on in Make.
    if ((t.hasAttribute('data-usepic') || t.hasAttribute('data-usevid') || t.hasAttribute('data-use')) && S.tab !== 'make') {
      var step = t.hasAttribute('data-usevid') ? S.step : STEPS.indexOf('describe');
      tab('make');
      return go(step);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'chatin') S.chatDraft = e.target.value;
    if (e.target.id === 'labseed') S.labSeed = e.target.value;
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'chatin' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
  });
  window.addEventListener('hashchange', function () { var h = (location.hash || '').slice(1); if (tabOk(h) && h !== S.tab) tab(h); });
  setInterval(function () { if (!document.hidden && S.tab === 'lab' && on() && !S.busy) loadLab(); }, 8000);
`;
