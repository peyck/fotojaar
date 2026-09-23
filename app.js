/* Fotojaar – raad het jaar van historische foto's.
 * Volledig clientside: data/photos.json bevat de weekplanning, voortgang
 * wordt in localStorage van de speler bewaard. */
(() => {
  'use strict';

  const DAY = 86400000;
  const MAX_PTS = 1000;
  const STORE = 'fotojaar:v1:';
  const $ = (id) => document.getElementById(id);

  let data = null;       // inhoud van photos.json
  let weekIdx = 0;       // welke week wordt gespeeld
  let currentWeek = 0;   // de week van vandaag
  let items = [];        // de 5 foto's van deze week (gedecodeerd)
  let state = { g: [] }; // gokken van deze week
  let pos = 0;           // index van de huidige foto
  let revealed = false;

  /* ---------- hulpfuncties ---------- */

  // Kalenderdag in lokale tijd, als UTC-middernacht (vermijdt zomeruur-gedoe).
  const dayUTC = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fmtDate = (t, opts) => new Date(t).toLocaleDateString('nl-BE', { timeZone: 'UTC', ...opts });

  function weekStart(n) { return parseISO(data.start) + n * 7 * DAY; }

  function decode(s) {
    // Lichte versluiering zodat het jaartal niet meteen leesbaar is in de JSON.
    const bin = atob(s);
    const key = data.key;
    let out = '';
    for (let i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    return JSON.parse(decodeURIComponent(escape(out)));
  }

  function itemsForWeek(n) {
    const all = data.items, per = data.perWeek, list = [];
    for (let i = 0; i < per; i++) {
      const raw = all[(n * per + i) % all.length];
      const secret = decode(raw.s);
      list.push({ src: raw.f, w: raw.w, h: raw.h, from: secret.y[0], to: secret.y[1], caption: secret.c || '' });
    }
    return list;
  }

  function diffYears(guess, it) {
    if (guess < it.from) return it.from - guess;
    if (guess > it.to) return guess - it.to;
    return 0;
  }
  const points = (d) => Math.round(MAX_PTS * Math.exp(-d / 10));
  const tier = (d) => (d <= 2 ? 0 : d <= 5 ? 1 : d <= 10 ? 2 : 3);
  const TIER_EMOJI = ['🟩', '🟨', '🟧', '🟥'];
  const TIER_COLOR = ['#3d8b4f', '#c9a227', '#d9782d', '#b8433a'];
  const yearLabel = (it) => (it.from === it.to ? String(it.from) : `${it.from}–${it.to}`);

  function load(n) {
    try { return JSON.parse(localStorage.getItem(STORE + 'w' + n)) || { g: [] }; }
    catch { return { g: [] }; }
  }
  function save() {
    try { localStorage.setItem(STORE + 'w' + weekIdx, JSON.stringify(state)); } catch { /* privémodus */ }
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- opstart ---------- */

  async function init() {
    try {
      const res = await fetch('data/photos.json', { cache: 'no-cache' });
      data = await res.json();
    } catch (e) {
      showEmpty('De fotolijst kon niet geladen worden.');
      return;
    }
    if (!data.items || data.items.length < data.perWeek) { showEmpty('Nog niet genoeg foto\'s beschikbaar.'); return; }

    currentWeek = Math.max(0, Math.floor((dayUTC(new Date()) - parseISO(data.start)) / (7 * DAY)));
    const q = new URLSearchParams(location.search).get('w');
    const req = q === null ? currentWeek : parseInt(q, 10) - 1;
    weekIdx = Number.isFinite(req) && req >= 0 && req <= currentWeek ? req : currentWeek;

    items = itemsForWeek(weekIdx);
    state = load(weekIdx);
    state.g = (Array.isArray(state.g) ? state.g : []).slice(0, items.length).map(Number).filter(Number.isFinite);

    const r = $('yearRange');
    r.min = data.minYear; r.max = data.maxYear;
    buildScale();

    $('weekTitle').textContent = `Week ${weekIdx + 1}` + (weekIdx === currentWeek ? '' : ' (archief)');
    const s = weekStart(weekIdx);
    $('weekRange').textContent = `${fmtDate(s, { day: 'numeric', month: 'long' })} – ${fmtDate(s + 6 * DAY, { day: 'numeric', month: 'long', year: 'numeric' })}`;
    $('countInfo').textContent = `${data.items.length} foto's in de verzameling`;

    bindUI();
    if (!localStorage.getItem(STORE + 'seenHelp')) {
      try { localStorage.setItem(STORE + 'seenHelp', '1'); } catch {}
      $('help').showModal();
    }
    state.g.length >= items.length ? showDone() : showPhoto(state.g.length);
  }

  function showEmpty(msg) {
    $('emptyMsg').textContent = msg;
    $('empty').hidden = false;
  }

  function buildScale() {
    const min = data.minYear, max = data.maxYear, span = max - min;
    const step = span > 120 ? 25 : span > 60 ? 20 : 10;
    const el = $('scale');
    el.innerHTML = '';
    for (let y = Math.ceil(min / step) * step; y <= max; y += step) {
      const s = document.createElement('span');
      s.textContent = y;
      s.style.left = ((y - min) / span) * 100 + '%';
      el.appendChild(s);
    }
  }

  /* ---------- speelverloop ---------- */

  function renderPips() {
    const ol = $('pips');
    ol.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.textContent = i + 1;
      if (i < state.g.length) {
        const d = diffYears(state.g[i], it);
        li.classList.add('scored');
        li.style.background = TIER_COLOR[tier(d)];
        li.title = `${points(d)} punten`;
      } else if (i === pos && !$('play').hidden) {
        li.classList.add('current');
      }
      ol.appendChild(li);
    });
  }

  function setYear(y) {
    const r = $('yearRange');
    y = Math.max(+r.min, Math.min(+r.max, Math.round(y)));
    r.value = y;
    $('yearOut').textContent = y;
  }

  function showPhoto(i) {
    pos = i;
    revealed = false;
    $('done').hidden = true;
    $('play').hidden = false;
    $('guessPanel').hidden = false;
    $('revealPanel').hidden = true;

    const img = $('photo');
    img.classList.remove('ready');
    $('photoLoading').hidden = false;
    img.onload = () => { img.classList.add('ready'); $('photoLoading').hidden = true; };
    img.onerror = () => { $('photoLoading').textContent = 'Foto kon niet geladen worden.'; };
    img.src = items[i].src;
    if (items[i + 1]) new Image().src = items[i + 1].src; // alvast de volgende laden

    setYear(Math.round((data.minYear + data.maxYear) / 2 / 5) * 5);
    renderPips();
    $('guessBtn').focus({ preventScroll: true });
  }

  function confirmGuess() {
    if (revealed || $('play').hidden) return;
    const g = +$('yearRange').value;
    state.g[pos] = g;
    save();
    reveal(pos, g);
  }

  function reveal(i, g) {
    revealed = true;
    const it = items[i];
    const d = diffYears(g, it);
    const pts = points(d);

    $('guessPanel').hidden = true;
    $('revealPanel').hidden = false;
    $('actualYear').textContent = yearLabel(it);
    $('pointsOut').textContent = pts;
    $('caption').textContent = it.caption;

    let v;
    if (d === 0) v = 'Precies juist!';
    else if (g < it.from) v = `${d} jaar te vroeg`;
    else v = `${d} jaar te laat`;
    $('verdict').textContent = TIER_EMOJI[tier(d)] + ' ' + v;

    // Tijdlijn: venster rond gok en juiste jaar
    const lo = Math.min(g, it.from), hi = Math.max(g, it.to);
    const pad = Math.max(5, (hi - lo) * 0.25);
    const a = lo - pad, b = hi + pad;
    const pct = (y) => ((y - a) / (b - a)) * 100 + '%';
    const mid = (it.from + it.to) / 2;
    const mg = $('markGuess'), ma = $('markActual'), gap = $('trackGap');
    mg.style.left = ma.style.left = pct((a + b) / 2);
    mg.querySelector('span').textContent = `jouw gok ${g}`;
    ma.querySelector('span').textContent = yearLabel(it);
    gap.style.left = pct(Math.min(g, mid));
    gap.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      mg.style.left = pct(g);
      ma.style.left = pct(mid);
      gap.style.width = `calc(${pct(Math.max(g, mid))} - ${pct(Math.min(g, mid))})`;
    }));

    $('nextBtn').textContent = i + 1 < items.length ? 'Volgende foto' : 'Bekijk je score';
    renderPips();
    $('nextBtn').focus({ preventScroll: true });
    $('revealPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function next() {
    if (pos + 1 < items.length) showPhoto(pos + 1);
    else showDone();
  }

  function showDone() {
    $('play').hidden = true;
    $('done').hidden = false;
    pos = items.length;
    renderPips();

    let total = 0;
    const ul = $('results');
    ul.innerHTML = '';
    items.forEach((it, i) => {
      const g = state.g[i], d = diffYears(g, it), p = points(d);
      total += p;
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = it.src; img.alt = `Foto ${i + 1}`; img.loading = 'lazy';
      img.addEventListener('click', () => openLightbox(it.src));
      const txt = document.createElement('div');
      txt.innerHTML = `<div class="r-years">${TIER_EMOJI[tier(d)]} ${yearLabel(it)}</div><div class="muted small">jouw gok: ${g}${d ? ` (${d} jaar ernaast)` : ''}</div>`;
      if (it.caption) {
        const c = document.createElement('div');
        c.className = 'muted small';
        c.textContent = it.caption;
        txt.appendChild(c);
      }
      const pts = document.createElement('div');
      pts.className = 'r-pts';
      pts.textContent = p;
      li.append(img, txt, pts);
      ul.appendChild(li);
    });
    const max = MAX_PTS * items.length;
    $('totalOut').textContent = total;
    $('maxOut').textContent = max;
    const f = total / max;
    $('rating').textContent =
      f >= 0.9 ? 'Archivaris met röntgenblik!' :
      f >= 0.75 ? 'Uitstekend – jij kent je fotokartons.' :
      f >= 0.55 ? 'Goed gedaan!' :
      f >= 0.35 ? 'Niet slecht, de mode verraadt veel.' :
      'Tijdreizen is lastig. Volgende week beter!';

    if (weekIdx === currentWeek) {
      const nextStart = weekStart(currentWeek + 1);
      const days = Math.round((nextStart - dayUTC(new Date())) / DAY);
      $('nextWeek').textContent = `Nieuwe foto's ${days <= 1 ? 'morgen' : `over ${days} dagen`} (maandag ${fmtDate(nextStart, { day: 'numeric', month: 'long' })}).`;
    } else {
      $('nextWeek').innerHTML = '<a href="./">Naar de foto\'s van deze week</a>';
    }
    $('shareBtn').focus({ preventScroll: true });
  }

  /* ---------- delen ---------- */

  const SITE_URL = (document.querySelector('link[rel=canonical]') || {}).href || location.origin + location.pathname;
  const shareUrl = () => (weekIdx === currentWeek ? SITE_URL : `${SITE_URL}?w=${weekIdx + 1}`);
  let shareFile = null;

  function shareSummary() {
    const diffs = items.map((it, i) => diffYears(state.g[i], it));
    const total = diffs.reduce((s, d) => s + points(d), 0);
    return { diffs, total, max: MAX_PTS * items.length };
  }

  function shareText() {
    const { diffs, total, max } = shareSummary();
    const squares = diffs.map((d) => TIER_EMOJI[tier(d)]).join('');
    return `Fotojaar week ${weekIdx + 1}: ${total}/${max} ${squares}\nRaad jij het jaar van deze oude foto's?`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Scorekaart als afbeelding (1080×1350, het portretformaat van Instagram).
  // Bewust zonder de foto's en jaartallen, zodat niemand gespoild wordt.
  async function makeShareImage() {
    try { await Promise.all(['700 80px Fraunces', '400 30px Inter', '600 30px Inter'].map((f) => document.fonts.load(f))); } catch {}
    const W = 1080, H = 1350;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const serif = 'Fraunces, Georgia, serif', sans = 'Inter, system-ui, sans-serif';
    const { diffs, total, max } = shareSummary();

    // achtergrond: papier met een fotokarton-kader
    ctx.fillStyle = '#e9e0d0'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fbf8f2'; roundRect(ctx, 50, 50, W - 100, H - 100, 28); ctx.fill();
    ctx.strokeStyle = '#d6c7ae'; ctx.lineWidth = 3; roundRect(ctx, 74, 74, W - 148, H - 148, 18); ctx.stroke();

    // kop
    ctx.fillStyle = '#8a5a2b'; roundRect(ctx, 130, 138, 58, 48, 6); ctx.fill();
    ctx.fillStyle = '#fbf8f2'; ctx.fillRect(138, 146, 42, 32);
    ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.arc(159, 162, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2420'; ctx.font = `700 64px ${serif}`; ctx.textBaseline = 'middle';
    ctx.fillText('Fotojaar', 210, 164);
    ctx.fillStyle = '#7a6d62'; ctx.font = `400 34px ${sans}`; ctx.textAlign = 'right';
    ctx.fillText(`Week ${weekIdx + 1}`, W - 130, 166);

    // totaalscore
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7a6d62'; ctx.font = `400 32px ${sans}`;
    ctx.fillText('mijn score', W / 2, 270);
    ctx.fillStyle = '#2b2420'; ctx.font = `700 170px ${serif}`;
    const tw = ctx.measureText(String(total)).width;
    ctx.font = `700 54px ${serif}`;
    const mw = ctx.measureText(` / ${max}`).width;
    const sx = W / 2 - (tw + mw) / 2;
    ctx.textAlign = 'left';
    ctx.font = `700 170px ${serif}`; ctx.fillText(String(total), sx, 380);
    ctx.fillStyle = '#9a8b7c'; ctx.font = `700 54px ${serif}`; ctx.fillText(` / ${max}`, sx + tw, 410);

    // per foto een rij
    const top = 500, rowH = 118, x0 = 130, x1 = W - 130;
    diffs.forEach((d, i) => {
      const y = top + i * rowH, t = tier(d), p = points(d);
      ctx.fillStyle = TIER_COLOR[t]; roundRect(ctx, x0, y, 76, 76, 14); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `600 36px ${sans}`; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), x0 + 38, y + 40);
      ctx.textAlign = 'left'; ctx.fillStyle = '#2b2420'; ctx.font = `600 36px ${sans}`;
      ctx.fillText(d === 0 ? 'Precies juist!' : `${d} jaar ernaast`, x0 + 104, y + 26);
      // puntenbalk
      const bx = x0 + 104, bw = x1 - bx - 120;
      ctx.fillStyle = '#ece3d4'; roundRect(ctx, bx, y + 56, bw, 14, 7); ctx.fill();
      if (p > 0) { ctx.fillStyle = TIER_COLOR[t]; roundRect(ctx, bx, y + 56, Math.max(14, bw * p / MAX_PTS), 14, 7); ctx.fill(); }
      ctx.textAlign = 'right'; ctx.fillStyle = '#2b2420'; ctx.font = `700 44px ${serif}`;
      ctx.fillText(String(p), x1, y + 40);
    });

    // voet met link
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2b2420'; ctx.font = `700 46px ${serif}`;
    ctx.fillText('Raad jij het jaar?', W / 2, 1150);
    ctx.fillStyle = '#8a5a2b'; ctx.font = `600 36px ${sans}`;
    ctx.fillText(SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, 1210);

    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    return new File([blob], `fotojaar-week-${weekIdx + 1}.png`, { type: 'image/png' });
  }

  async function openShare() {
    const dlg = $('shareDlg');
    $('shareImg').removeAttribute('src');
    dlg.showModal();
    shareFile = await makeShareImage();
    const img = $('shareImg');
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = URL.createObjectURL(shareFile);
    img.src = img.dataset.url;
    $('shNative').hidden = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
    $('shCopyImg').hidden = !(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
  }

  const openWin = (url) => window.open(url, '_blank', 'noopener');

  function bindShare() {
    $('shareBtn').addEventListener('click', openShare);
    $('shNative').addEventListener('click', async () => {
      try {
        await navigator.share({ files: [shareFile], title: 'Fotojaar', text: `${shareText()}\n${shareUrl()}` });
      } catch { /* geannuleerd */ }
    });
    $('shWhatsapp').addEventListener('click', () =>
      openWin('https://wa.me/?text=' + encodeURIComponent(`${shareText()}\n${shareUrl()}`)));
    $('shFacebook').addEventListener('click', () =>
      openWin('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl())));
    $('shEmail').addEventListener('click', () => {
      location.href = 'mailto:?subject=' + encodeURIComponent(`Fotojaar – week ${weekIdx + 1}`) +
        '&body=' + encodeURIComponent(`${shareText()}\n\nSpeel mee: ${shareUrl()}`);
    });
    $('shDownload').addEventListener('click', () => {
      if (!shareFile) return;
      const a = document.createElement('a');
      a.href = $('shareImg').dataset.url; a.download = shareFile.name; a.click();
    });
    $('shCopyImg').addEventListener('click', async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': shareFile })]); toast('Afbeelding gekopieerd'); }
      catch { toast('Kopiëren lukte niet – bewaar de afbeelding'); }
    });
    $('shCopyText').addEventListener('click', async () => {
      const t = `${shareText()}\n${shareUrl()}`;
      try { await navigator.clipboard.writeText(t); toast('Tekst en link gekopieerd'); }
      catch { prompt('Kopieer je resultaat:', t); }
    });
  }

  /* ---------- archief & statistiek ---------- */

  function renderArchive() {
    const ul = $('archiveList');
    ul.innerHTML = '';
    for (let n = currentWeek; n >= 0; n--) {
      const st = load(n), its = itemsForWeek(n);
      let label = 'nog niet gespeeld';
      if (st.g && st.g.length >= its.length) {
        const tot = its.reduce((s, it, i) => s + points(diffYears(st.g[i], it)), 0);
        label = `${tot} punten`;
      } else if (st.g && st.g.length) label = `${st.g.length}/${its.length} gespeeld`;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = n === currentWeek ? './' : `?w=${n + 1}`;
      if (n === weekIdx) a.className = 'cur';
      a.innerHTML = `<span><b>Week ${n + 1}</b> <span class="muted small">${fmtDate(weekStart(n), { day: 'numeric', month: 'short', year: 'numeric' })}</span></span><span class="muted small"></span>`;
      a.lastChild.textContent = label;
      li.appendChild(a);
      ul.appendChild(li);
    }
  }

  function renderStats() {
    let played = 0, sum = 0, best = 0, streak = 0, streakOpen = true;
    const tiers = [0, 0, 0, 0];
    for (let n = currentWeek; n >= 0; n--) {
      const st = load(n), its = itemsForWeek(n);
      const complete = st.g && st.g.length >= its.length;
      if (complete) {
        const tot = its.reduce((s, it, i) => {
          const d = diffYears(st.g[i], it);
          tiers[tier(d)]++;
          return s + points(d);
        }, 0);
        played++; sum += tot; best = Math.max(best, tot);
      }
      // reeks: opeenvolgende volledige weken; de lopende week mag nog open staan
      if (streakOpen) {
        if (complete) streak++;
        else if (n !== currentWeek) streakOpen = false;
      }
    }
    const cells = [
      [played, 'weken gespeeld'],
      [played ? Math.round(sum / played) : 0, 'gemiddelde'],
      [best, 'beste week'],
      [streak, 'weken op rij'],
    ];
    $('statGrid').innerHTML = cells.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    const labels = ['🟩 0–2 jaar', '🟨 3–5 jaar', '🟧 6–10 jaar', '🟥 >10 jaar'];
    const mx = Math.max(1, ...tiers);
    $('dist').innerHTML = tiers.map((c, i) =>
      `<div class="dist-row"><span>${labels[i]}</span><div class="dist-bar" style="width:${(c / mx) * 100}%;background:${TIER_COLOR[i]}"></div><span>${c}</span></div>`
    ).join('');
  }

  /* ---------- lichtbak ---------- */

  function openLightbox(src) {
    const lb = $('lightbox');
    $('lightImg').src = src;
    lb.classList.remove('full');
    lb.hidden = false;
  }
  function closeLightbox() { $('lightbox').hidden = true; }

  /* ---------- events ---------- */

  function bindUI() {
    const r = $('yearRange');
    r.addEventListener('input', () => setYear(+r.value));
    document.querySelectorAll('.step').forEach((b) =>
      b.addEventListener('click', () => setYear(+r.value + +b.dataset.step)));
    $('guessBtn').addEventListener('click', confirmGuess);
    $('nextBtn').addEventListener('click', next);
    bindShare();
    $('photo').addEventListener('click', () => openLightbox(items[pos].src));
    $('zoomBtn').addEventListener('click', () => openLightbox(items[pos].src));

    const lb = $('lightbox');
    lb.addEventListener('click', (e) => {
      if (e.target.classList.contains('lightclose')) return closeLightbox();
      // eerste klik: ware grootte, tweede klik: sluiten
      if (e.target === $('lightImg') && !lb.classList.contains('full')) lb.classList.add('full');
      else closeLightbox();
    });

    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.open;
      if (id === 'archive') renderArchive();
      if (id === 'stats') renderStats();
      $(id).showModal();
    }));

    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      if (!$('lightbox').hidden) { if (e.key === 'Escape') closeLightbox(); return; }
      const playing = !$('play').hidden && !revealed;
      if (playing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target !== r) {
        e.preventDefault();
        setYear(+r.value + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
      } else if (playing && e.target === r && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setYear(+r.value + (e.key === 'ArrowLeft' ? -10 : 10));
      } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        if (playing) confirmGuess();
        else if (revealed && !$('play').hidden) next();
      }
    });
  }

  init();
})();
