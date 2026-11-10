(function () {
  const L = window.SamaLogic, { T, langs } = window.SamaI18n;
  const store = L.makeStore(localStorage);
  const FAST = new URLSearchParams(location.search).has('fast'); // ?fast=1 shortens timers for testing only
  const QP = new URLSearchParams(location.search);
  const BASELINE_SEC = FAST ? 6 : 30, REHEARSAL_SEC = Number(QP.get('rehearsal')) || (FAST ? 20 : 300); // ?rehearsal=SECONDS shortens the rehearsal for demos
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  let lang = localStorage.getItem('sama.lang') || 'hn';
  const t = (k) => (T[lang] && T[lang][k]) || T.hn[k] || k;
  let status = { liveAvailable: false };
  const S = { stage: 'consent', mode: 'mock', pattern: 'sama', source: null, latest: null, baseline: [], rehearsal: [], timer: null, progress: {}, rt: 0, result: null, agreed: false };

  /* ---------- data sources ---------- */
  function mockSource(onData) {
    let tick = 0, fault = 0;
    const id = setInterval(() => {
      tick++;
      if (tick % 45 === 0) fault = 3; // brief simulated signal drop so the gate can be seen working
      const bad = fault > 0; if (bad) fault--;
      const ph = Math.sin(tick / 6);
      onData({
        validationCode: bad ? 1 : 0, hint: bad ? 'No face found.' : '',
        pulse: { value: 72 + 2 * Math.sin(tick / 20), confidence: 0.8, stable: true },
        breath: { value: 14 - Math.min(5, tick / 60) + 0.4 * ph, confidence: 0.8, stable: true },
        trace: [ph],
      });
    }, 500);
    return { stop() { clearInterval(id); }, label: 'demo' };
  }

  async function liveSource(onData, onError) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    const video = document.createElement('video'); video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play();
    S.video = video;
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/stream' + (new URLSearchParams(location.search).get('k') ? '?k=' + encodeURIComponent(new URLSearchParams(location.search).get('k')) : ''));
    ws.binaryType = 'arraybuffer';
    const cur = { validationCode: 1, hint: '', pulse: null, breath: null, trace: [] };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('server connection failed')); });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'validation') { cur.validationCode = m.code; cur.hint = m.hint; onData(Object.assign({}, cur)); }
      else if (m.type === 'metrics') { if (m.pulse) cur.pulse = m.pulse; if (m.breath) cur.breath = m.breath; cur.trace = m.trace || []; onData(Object.assign({}, cur)); }
      else if (m.type === 'error') onError(m.message);
    };
    ws.send(JSON.stringify({ type: 'start' }));
    const t0 = performance.now();
    const id = setInterval(() => {
      if (ws.readyState !== 1) return;
      ctx.drawImage(video, 0, 0, 320, 240);
      const px = ctx.getImageData(0, 0, 320, 240).data;
      const buf = new ArrayBuffer(8 + px.length), dv = new DataView(buf);
      dv.setUint16(0, 320, true); dv.setUint16(2, 240, true); dv.setUint32(4, Math.round(performance.now() - t0), true);
      new Uint8Array(buf, 8).set(px);
      ws.send(buf);
    }, 33); // the SDK needs a high frame rate (about 30 fps) or it stops with a low-frame-rate error
    return { stop() { clearInterval(id); try { ws.send(JSON.stringify({ type: 'stop' })); } catch (e) {} ws.close(); stream.getTracks().forEach((x) => x.stop()); }, label: 'live-presage-sdk' };
  }

  async function startSource() {
    const onData = (d) => { S.latest = d; };
    const onError = (m) => { S.error = m; render(); };
    S.error = null;
    S.source = S.mode === 'live' ? await liveSource(onData, onError) : mockSource(onData);
  }
  function stopSource() { if (S.source) S.source.stop(); S.source = null; S.video = null; clearInterval(S.timer); }

  /* ---------- flow ---------- */
  async function begin() {
    try { await startSource(); } catch (e) { S.error = e.message; render(); return; }
    S.stage = 'baseline'; S.baseline = []; S.rehearsal = []; S.progress = { good: 0, paused: 0, done: false };
    render();
    S.timer = setInterval(() => {
      const gate = L.evaluateGate(S.latest);
      S.gate = gate;
      S.progress = L.tickGate(S.progress, gate, 1, BASELINE_SEC);
      if (gate.ok) S.baseline.push({ pulse: S.latest.pulse && S.latest.pulse.value, breath: S.latest.breath && S.latest.breath.value });
      updateBaseline();
      if (S.progress.done) { clearInterval(S.timer); startRehearsal(); }
    }, 1000);
  }
  function startRehearsal() {
    S.stage = 'rehearsal'; S.rt = 0; render();
    S.timer = setInterval(() => {
      S.rt += 0.25;
      updatePacer();
      if (Math.abs(S.rt % 1) < 0.01) {
        const gate = L.evaluateGate(S.latest);
        if (gate.ok) S.rehearsal.push({ pulse: S.latest.pulse && S.latest.pulse.value, breath: S.latest.breath && S.latest.breath.value });
      }
      if (S.rt >= REHEARSAL_SEC) finish();
    }, 250);
  }
  function finish() {
    const src = S.source && S.source.label;
    stopSource();
    S.result = L.computeReadiness(S.baseline, S.rehearsal); S.result.source = src;
    S.stage = 'result'; render();
  }
  function abort() { stopSource(); S.stage = 'consent'; render(); }

  /* ---------- views ---------- */
  const fmt = (v, d = 0) => (v == null ? '-' : v.toFixed(d));
  function render() {
    $('#appTitle').textContent = t('title');
    $('#histBtn').textContent = t('history') + ' (' + store.list().length + ')';
    $('#langs').innerHTML = Object.keys(langs).map((k) => `<button class="lang ${k === lang ? 'on' : ''}" data-l="${k}">${langs[k]}</button>`).join('');
    document.querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => { lang = b.dataset.l; localStorage.setItem('sama.lang', lang); render(); }));
    if (S.stage === 'consent') return viewConsent();
    if (S.stage === 'baseline') return viewBaseline();
    if (S.stage === 'rehearsal') return viewRehearsal();
    return viewResult();
  }
  function viewConsent() {
    const liveOk = status.liveAvailable;
    app.innerHTML = `<div class="card"><h2>${t('consentH')}</h2><p>${t('consentCamera')}</p><p>${t('consentData')}</p><p>${t('consentStore')}</p><p><b>${t('consentWellness')}</b></p></div>
    <div class="card"><label><input type="checkbox" id="agree" ${S.agreed ? 'checked' : ''}> ${t('agree')}</label>
    <p class="row"><label><input type="radio" name="m" value="live" ${S.mode === 'live' ? 'checked' : ''} ${liveOk ? '' : 'disabled'}> ${t('modeLive')}</label>
    <label><input type="radio" name="m" value="mock" ${S.mode === 'mock' ? 'checked' : ''}> ${t('modeMock')}</label></p>
    ${liveOk ? `<p class="mute">${t('credits')}</p>` : `<p class="mute warn">${t('liveOff')}</p>`}
    <p class="row">${t('pattern')}: ${['sama', 'box', 'shanti'].map((p) => `<label><input type="radio" name="p" value="${p}" ${S.pattern === p ? 'checked' : ''}> ${t('p' + p[0].toUpperCase() + p.slice(1))}</label>`).join(' ')}</p>
    ${S.error ? `<p class="warn">${S.error}</p>` : ''}
    <button id="go" ${S.agreed ? '' : 'disabled'}>${t('start')}</button></div>`;
    $('#agree').onchange = (e) => { S.agreed = e.target.checked; $('#go').disabled = !S.agreed; };
    document.querySelectorAll('[name=m]').forEach((r) => (r.onchange = () => (S.mode = r.value)));
    document.querySelectorAll('[name=p]').forEach((r) => (r.onchange = () => (S.pattern = r.value)));
    $('#go').onclick = begin;
  }
  function vText(c) { return c === 0 ? t('v0') : c === 1 ? t('v1') : t('vOther'); }
  function viewBaseline() {
    app.innerHTML = `<div class="card"><h2>${t('baselineH')}</h2><p>${t('baselineHint')}</p>${S.mode === 'live' ? '<div id="vid"></div>' : ''}
    <div class="bar"><i id="bl" style="width:0"></i></div><p id="gs" class="mute"></p><p id="vals"></p>
    ${S.error ? `<p class="warn">${S.error}</p>` : ''}<button class="sec" id="stop">${t('stop')}</button></div>`;
    if (S.video) { $('#vid').appendChild(S.video); S.video.style.cssText = 'width:240px;border-radius:10px;transform:scaleX(-1)'; }
    $('#stop').onclick = abort;
    updateBaseline();
  }
  function updateBaseline() {
    const g = S.gate || { ok: false };
    $('#bl').style.width = (100 * (S.progress.good || 0) / BASELINE_SEC) + '%';
    const hint = S.latest && S.latest.hint ? ' - ' + S.latest.hint : '';
    $('#gs').textContent = (g.ok ? t('good') : t('paused')) + ' (' + vText(S.latest ? S.latest.validationCode : 1) + hint + ')';
    $('#gs').className = 'mute ' + (g.ok ? '' : 'warn');
    updateVals();
  }
  function updateVals() {
    const el = $('#vals'); if (!el || !S.latest) return;
    const p = S.latest.pulse, b = S.latest.breath;
    el.innerHTML = `${t('pulse')}: <b>${p ? fmt(p.value) : '-'}</b> ${t('bpm')} &nbsp; ${t('breath')}: <b>${b ? fmt(b.value, 1) : '-'}</b> ${t('brpm')} <span class="mute">(${S.source ? S.source.label : ''})</span>`;
  }
  function viewRehearsal() {
    app.innerHTML = `<div class="card"><h2>${t('rehearsalH')}</h2><div id="pacer"></div><div class="bar"><i id="rp" style="width:0"></i></div>
    <p id="vals"></p><p id="gs" class="mute"></p>${S.mode === 'live' ? '<div id="vid"></div>' : ''}<button class="sec" id="stop">${t('stop')}</button></div>`;
    if (S.video) { $('#vid').appendChild(S.video); S.video.style.cssText = 'width:200px;border-radius:10px;transform:scaleX(-1)'; }
    $('#stop').onclick = abort;
    updatePacer();
  }
  function updatePacer() {
    const ph = L.pacerPhase(S.pattern, S.rt);
    const scale = ph.phase === 'inhale' ? 0.7 + 0.3 * ph.progress : ph.phase === 'exhale' ? 1 - 0.3 * ph.progress : (S.lastScale || 1);
    S.lastScale = scale;
    const el = $('#pacer'); if (!el) return;
    el.style.transform = `scale(${scale})`; el.textContent = t(ph.phase);
    $('#rp').style.width = (100 * S.rt / REHEARSAL_SEC) + '%';
    const g = L.evaluateGate(S.latest);
    $('#gs').textContent = g.ok ? t('good') : t('paused');
    updateVals();
  }
  function viewResult() {
    const r = S.result;
    if (!r.enough) { app.innerHTML = `<div class="card"><h2>${t('resultH')}</h2><p class="warn">${t('paused')}</p><button id="again">${t('newSession')}</button></div>`; $('#again').onclick = () => { S.stage = 'consent'; render(); }; return; }
    app.innerHTML = `<div class="card"><h2>${t('resultH')}</h2><p class="stat">${t(r.label)}</p>
    <table><tr><td></td><td>${t('baseline')}</td><td>${t('rehearsal')}</td></tr>
    <tr><td>${t('pulse')} (${t('bpm')})</td><td>${fmt(r.baseline.pulse)}</td><td>${fmt(r.rehearsal.pulse)}</td></tr>
    <tr><td>${t('breath')} (${t('brpm')})</td><td>${fmt(r.baseline.breath, 1)}</td><td>${fmt(r.rehearsal.breath, 1)}</td></tr></table>
    <p class="mute">${t('resultNote')}</p><p class="mute">source: ${r.source}</p>
    <textarea id="note" placeholder="${t('reflection')}" rows="2" style="width:100%"></textarea>
    <p class="row"><button id="save">${t('save')}</button><button class="sec" id="again">${t('newSession')}</button></p></div>`;
    $('#save').onclick = () => {
      store.add({ id: 'S' + Date.now(), at: new Date().toISOString(), pattern: S.pattern, source: r.source, summary: { label: r.label, baseline: r.baseline, rehearsal: r.rehearsal, pulseDelta: r.pulseDelta, breathDelta: r.breathDelta, samples: r.samples }, note: $('#note').value, wellnessOnly: true });
      $('#save').disabled = true; render2();
    };
    $('#again').onclick = () => { S.stage = 'consent'; render(); };
  }
  function render2() { $('#histBtn').textContent = t('history') + ' (' + store.list().length + ')'; }

  /* ---------- history ---------- */
  function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); }
  function showHistory() {
    const all = store.list();
    $('#histBody').innerHTML = `<h3>${t('history')}</h3>` + (all.length ? all.map((s) => `<div class="card"><b>${new Date(s.at).toLocaleString()}</b> - ${t(s.summary.label)} (${s.source})<pre>${JSON.stringify(s.summary, null, 1)}</pre><button data-e="${s.id}">${t('exportOne')}</button> <button class="sec" data-d="${s.id}">${t('del')}</button></div>`).join('') : `<p>${t('empty')}</p>`) +
      `<p class="row"><button id="ea" ${all.length ? '' : 'disabled'}>${t('exportAll')}</button><button class="sec" id="da" ${all.length ? '' : 'disabled'}>${t('delAll')}</button></p>`;
    document.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => download('sama-' + b.dataset.e + '.json', store.exportOne(b.dataset.e))));
    document.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { store.remove(b.dataset.d); showHistory(); render2(); }));
    const ea = $('#ea'), da = $('#da');
    if (ea) ea.onclick = () => download('sama-all.json', store.exportAll());
    if (da) da.onclick = () => { store.clear(); showHistory(); render2(); };
    if (!$('#histDlg').open) $('#histDlg').showModal();
  }
  $('#histBtn').onclick = showHistory; $('#histClose').onclick = () => $('#histDlg').close();

  if (QP.get('banner')) { const b = document.createElement('div'); b.textContent = QP.get('banner'); b.style.cssText = 'background:#b4531e;color:#fff;text-align:center;padding:6px;font-size:.9rem'; document.body.insertBefore(b, document.body.firstChild); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  fetch('/api/status').then((r) => r.json()).then((s) => { status = s; if (s.liveAvailable) S.mode = 'live'; render(); }).catch(() => render());
  render();
})();
