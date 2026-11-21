'use strict';
/* HerrasmiesKlubi Gaala – käyttöliittymä (ei riippuvuuksia) */

let state = null;
let showFinalCounts = false;
// Muokattavana oleva kohde: { kind: 'cat' | 'nom', id, admin } tai null.
// Säilyy uudelleenpiirroissa (myös 15 s automaattipäivityksessä), joten keskeneräinen muokkaus ei katoa.
let editing = null;
// Ehdokasvaiheessa valittu henkilökortti: { catId, personId } tai null (perusteen kirjoittaminen kesken)
let proposing = null;
// Rajausikkuna (vain admin): { target: 'user' | 'nom', id, src, x, y, z, name, reason } tai null
let cropping = null;
// Osallistujan tilastoikkuna (vain admin): palvelimen palauttamat tilastot tai null
let stats = null;
let meCard = false; // käyttäjäkortti auki
let photosOpen = false; // "Ehdota profiilikuvia" -näkymä auki
let hofOpen = false; // Hall of Fame -näkymä auki
let hofYearSel = null; // valittu vuosi (null = uusin); näkyy osoitteessa muodossa #hall-of-fame/2025
let hofDraft = null; // Hall of Fame -lomakkeen luonnos: { id, year, categories, dirty }; null = lomake kiinni
const versionsOpen = new Set(); // henkilöt, joiden kuvaversiot on avattu näkyviin
let previewVersion = null; // esikatseltavan kuvaversion id

// Palkintosivu (pokaalin QR-koodi): /p/<tunniste>. Näkyy ilman kirjautumista, eikä se käytä muuta sovellusta.
const AWARD_TOKEN = (/^\/p\/([A-Za-z0-9_-]{10})\/?$/.exec(location.pathname) || [])[1] || null;
let award = null; // palvelimen palauttama palkintosivu tai { error }
// Hall of Famesta pääsee takaisin palkintosivulle, jos sinne tultiin palkintosivulta (sama välilehti)
const awardBack = () => { try { const u = sessionStorage.getItem('awardBack'); return /^\/p\/[A-Za-z0-9_-]{10}$/.test(u || '') ? u : null; } catch { return null; } };

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- API ----------
async function api(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Jokin meni pieleen.');
    if (data && 'phase' in data) {
      state = data;
      if (isTest()) state.lockReady = simLockReady(); // testikäyttäjän lukitusehdot paikallisesta tilasta
      render();
    }
    if (data && data.notice) toast(data.notice);
    return data;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}
// Testikäyttäjän esikatseltava vaihe (null = oikea vaihe)
let previewPhase = null;
const isTest = () => !!(state && state.me && state.me.tester);
const refresh = () => api('GET', previewPhase ? `/api/state?phase=${previewPhase}` : '/api/state').catch(() => {});

let toastTimer;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------- Render (säilyttää kirjoitetut tekstit) ----------
function render() {
  const app = $('#app');
  const kept = {};
  app.querySelectorAll('[data-keep]').forEach((el) => (kept[el.id] = el.value));
  const active = document.activeElement && document.activeElement.id;
  const sel = active && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;

  if (AWARD_TOKEN) { app.innerHTML = awardPage(); return; }
  app.innerHTML = state.me ? mainView() : loginView();

  for (const [id, v] of Object.entries(kept)) { const el = document.getElementById(id); if (el && v) el.value = v; }
  if (active) { const el = document.getElementById(active); if (el) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel); } catch {} } }
  // Hall of Famen valittu vuosi näkyviin välilehtirivillä (vain rivi vierii, ei sivu)
  const tabs = app.querySelector('.hof-tabs'); const cur = tabs && tabs.querySelector('[aria-selected="true"]');
  if (cur) tabs.scrollLeft = cur.offsetLeft - (tabs.clientWidth - cur.offsetWidth) / 2;
}

// Sivun alaosa: Gaalan järjestäjä
function footer() {
  return '<footer class="footer"><span>Default Settings Oy</span></footer>';
}

// ---------- Kirjautuminen ----------
function brand() {
  return `<a class="brand" href="/" aria-label="HerrasmiesKlubi Gaala"><img class="brand-trophy" src="/logo.svg" alt="" width="108" height="236"><span class="brand-text" aria-hidden="true"><span class="brand-eyebrow">HerrasmiesKlubi</span><span class="brand-name">Gaala</span></span></a>`;
}

function loginView() {
  return `
  <div class="login">
    <div class="band" aria-hidden="true"><i style="flex:3;background:var(--gold-dark)"></i><i style="flex:.5;background:var(--gold-light)"></i><i style="flex:3;background:var(--red)"></i><i style="flex:1;background:var(--charcoal)"></i><i style="flex:2.5;background:var(--gold)"></i></div>
    <main class="wrap login-main">
      <div class="login-grid">
        <div style="display:grid;gap:24px">
          ${brand()}
          <h1 class="display">Kuka ansaitsee palkinnon tänä vuonna?</h1>
          <p class="lead">Ensin päätetään kategoriat, sitten ehdokkaat ja lopuksi voittajat. Voittajat paljastetaan Gaalassa.</p>
        </div>
        <form class="panel" id="login-form" autocomplete="off">
          <p class="eyebrow">Kirjaudu sisään</p>
          <div class="field"><label for="l-code">Henkilökohtainen koodisi</label><input class="input code-input" id="l-code" data-keep required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="XXXX-XXXX"></div>
          <button class="btn btn--primary" type="submit">Kirjaudu</button>
          <p class="small muted" style="margin:0">Saat koodin tai valmiin kirjautumislinkin järjestäjiltä. Koodi on vain sinun – älä jaa sitä.</p>
        </form>
      </div>
    </main>
  </div>`;
}

// ---------- Pääsivu ----------
function mainView() {
  const s = state;
  return `
  <header class="topbar"><div class="wrap">
    ${brand()}
    <div class="whoami">${hofButton()}${suggestButton()}${whoami()}<button class="btn btn--ghost" data-act="logout">Kirjaudu ulos</button></div>
  </div></header>
  ${s.me.tester ? testBar() : ''}
  ${hofOpen ? `<main class="wrap">${hofView()}${footer()}</main>` : photosOpen ? `<main class="wrap">${photosView()}${footer()}</main>` : `<main class="wrap">
    <section class="hero">
      ${stepper()}
      ${isWaiting() ? '' : phaseHero()}
    </section>
    ${s.me.root ? `<div class="panel"><p class="eyebrow">Ylläpitotunnus</p><p style="margin:0">Tällä tunnuksella hallinnoidaan, mutta ei äänestetä. Lisää itsesi osallistujaksi alta, anna itsellesi admin-oikeus ja kirjaudu omalla koodillasi.</p></div>` : phaseBody()}
    ${s.me.admin ? (s.me.tester && s.phase !== s.realPhase ? `<div class="panel" style="margin-top:48px"><p class="eyebrow">Hallinta</p><p class="small muted" style="margin:0">Hallinta on piilotettu, kun esikatselet muuta kuin oikeaa vaihetta (${s.realPhase}). Palaa oikeaan vaiheeseen testipalkista.</p></div>` : adminView()) : ''}
    ${footer()}
  </main>`}
  ${cropping ? cropView() : ''}
  ${stats ? statsView() : ''}
  ${meCard && s.me.photo ? meCardView() : ''}
  ${photosOpen && previewVersion ? versionPreview() : ''}`;
}

// Yläpalkin nimi. Jos käyttäjällä on kuva, sen pyöreä pikkukuva näkyy nimen vieressä
// ja koko painike avaa käyttäjäkortin (kuva + nimi).
function whoami() {
  const me = state.me;
  const label = `<span class="muted">${esc(me.name)}${me.admin ? ' · admin' : ''}</span>`;
  if (!me.photo) return `<span class="muted me-label">${esc(me.name)}${me.admin ? ' · admin' : ''}</span>`;
  return `<button class="me-chip" data-act="me-card" title="Näytä oma kortti" aria-label="Näytä oma kortti: ${esc(me.name)}">${portrait(me, 'me-avatar')}${label}</button>`;
}

// Yläpalkin Hall of Fame -nappi. Muille näkyy vasta, kun admin on julkaissut Hall of Famen ja siinä on sisältöä;
// adminille aina (piilotettuna merkillä "piilossa"), jotta sitä voi rakentaa rauhassa.
function hofButton() {
  if (!(state.hallOfFame || []).length && !state.me.admin) return '';
  const hidden = state.admin && !state.admin.hofPublished;
  return `<button class="btn btn--ghost hof-btn${hofOpen ? ' is-open' : ''}" data-act="${hofOpen ? 'hof-close' : 'hof-open'}" aria-pressed="${hofOpen}">Hall of Fame${hidden ? ' <span class="hof-hidden-tag">piilossa</span>' : ''}</button>`;
}

// Näkyvyys: admin julkaisee Hall of Famen muille, kun se on valmis (tai piilottaa sen taas).
function hofVisibility() {
  const pub = !!state.admin.hofPublished;
  return `
    <div class="panel hof-visibility${pub ? ' is-public' : ''}">
      <div class="hof-vis-text">
        <p class="eyebrow">Näkyvyys</p>
        <p style="margin:0">${pub ? '<b>Julkaistu.</b> Kaikki osallistujat näkevät Hall of Famen.' : '<b>Piilossa muilta.</b> Vain adminit näkevät Hall of Famen. Julkaise, kun se on valmis.'}</p>
      </div>
      <button class="btn btn--sm ${pub ? 'btn--secondary' : 'btn--primary'}" data-act="hof-publish" aria-pressed="${pub}">${pub ? 'Piilota muilta' : 'Julkaise Hall of Fame'}</button>
    </div>`;
}

// ---------- Palkintosivu (pokaalin QR-koodi) ----------
async function loadAward() {
  try {
    const res = await fetch(`/api/award/${AWARD_TOKEN}`, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    award = res.ok ? data : { error: data.error || 'Palkintosivua ei löydy.' };
  } catch { award = award || { error: 'Yhteys ei toimi juuri nyt. Yritä hetken päästä uudelleen.' }; }
  document.title = award && award.name ? `${award.name} · HerrasmiesKlubi Gaala` : 'HerrasmiesKlubi Gaala';
  render();
}

const PLACE_LABEL = { 1: '1. sija', 2: '2. sija', 3: '3. sija' };
// Palkintokorokkeen järjestys: 2. vasemmalla, 1. keskellä korkeimmalla, 3. oikealla
function awardPage() {
  const a = award;
  if (!a) return `<div class="award-page"><main class="wrap award-main"><p class="muted">Ladataan…</p></main></div>`;
  if (a.error) return `<div class="award-page"><main class="wrap award-main">${brand()}<h1 class="h1" style="margin-top:32px">${esc(a.error)}</h1></main>${footer()}</div>`;
  const col = (pl) => {
    const list = a.published ? a.places.filter((x) => x.place === pl) : [{ hidden: true }];
    if (!list.length) return `<div class="podium-col place-${pl} is-empty" aria-hidden="true"></div>`;
    return `
      <div class="podium-col place-${pl}">
        <p class="podium-place">${PLACE_LABEL[pl]}</p>
        ${list.map((x) => x.hidden ? `
        <article class="nom-card podium-card is-secret" aria-label="${PLACE_LABEL[pl]}: julkistetaan Gaalassa">
          <div class="nom-media"><div class="nom-mono"><span>?</span></div></div>
          <div class="nom-body"><h2 class="h3">Julkistetaan Gaalassa</h2></div>
        </article>` : `
        <article class="nom-card podium-card">
          <div class="nom-media">${portrait(x)}</div>
          <div class="nom-body"><h2 class="h3">${esc(x.name)}</h2>${x.reason ? `<p>${esc(x.reason)}</p>` : ''}</div>
        </article>`).join('')}
      </div>`;
  };
  const hofHref = `/#hall-of-fame${a.archived ? '/' + a.year : ''}`;
  return `
  <div class="award-page">
    <header class="award-top">${brand()}</header>
    <main class="wrap award-main">
      <header class="award-head">
        <p class="eyebrow">Gaala ${a.year}</p>
        <h1 class="display award-title">${esc(a.name)}</h1>
        ${a.description ? `<p class="lead">${esc(a.description)}</p>` : ''}
        ${a.published ? '' : '<p class="award-wait">Voittaja julkistetaan Gaalassa.</p>'}
      </header>
      <div class="podium${a.published ? '' : ' is-waiting'}">${col(2)}${col(1)}${col(3)}</div>
      <div class="award-actions">
        <a class="btn btn--secondary" href="${hofHref}" data-act="award-hof">Hall of Fame · kaikki voittajat</a>
        ${a.loggedIn ? '' : '<p class="small muted" style="margin:0">Hall of Fame näkyy Gaalan jäsenille kirjautumisen jälkeen.</p>'}
      </div>
    </main>
    ${footer()}
  </div>`;
}

// Hallinta: palkintosivujen linkit ja QR-koodit pokaaleihin
let awardEdit = null; // kategorian id, jonka sijoja muokataan käsin
function awardBase() { return (state.admin.awards && state.admin.awards.baseUrl) || location.origin; }
const awardUrl = (token) => `${awardBase()}/p/${token}`;

// QR-koodi SVG:nä (qrcode-generator, ladataan vain hallinnassa). Musta valkoisella ja leveä reunus, jotta
// koodi lukeutuu varmasti myös pienenä pokaalin pohjassa.
let qrLib = null;
function qrSvg(text, size = 132) {
  if (!qrLib) return `<div class="qr-box qr-loading" style="width:${size}px;height:${size}px"></div>`;
  const qr = qrLib(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); const m = 4; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg class="qr-box" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR-koodi: ${esc(text)}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function ensureQrLib() {
  if (qrLib) return;
  loadScript('/vendor/qrcode.js', 'qrcode').then((q) => { qrLib = q; render(); }).catch(() => toast('QR-kirjaston lataus epäonnistui.', true));
}
// PNG tulostusta varten: 1200 px, nimi tiedostonimessä
function downloadQrPng(text, name) {
  const qr = qrLib(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); const m = 4; const px = Math.floor(1200 / (n + 2 * m));
  const c = document.createElement('canvas'); c.width = c.height = px * (n + 2 * m);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) if (qr.isDark(r, cc)) g.fillRect((cc + m) * px, (r + m) * px, px, px);
  c.toBlob((blob) => {
    const link = document.createElement('a');
    link.download = `QR ${name.replace(/[\\/:*?"<>|]+/g, '')}.png`; link.href = URL.createObjectURL(blob);
    document.body.appendChild(link); link.click(); link.remove(); // linkki sivulla, jotta tiedostonimi säilyy
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }, 'image/png');
}
// SVG 3D-mallinnukseen (esim. Fusion 360: Insert → Insert SVG). Tummat moduulit yhdistetään yhtenäisiksi
// ääriviivoiksi (ei satoja erillisiä neliöitä), joten profiilit voi pursottaa suoraan. Koko millimetreinä,
// hiljainen reunus (4 moduulia) on mukana mittoina mutta ei muotoina, eikä taustaa ole.
function qrOutline(qr) {
  const n = qr.getModuleCount();
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const out = new Map(); // piste "x,y" → lähtevät reunat; tumma puoli aina kulkusuunnan oikealla
  const add = (x1, y1, x2, y2) => { const k = `${x1},${y1}`; if (!out.has(k)) out.set(k, []); out.get(k).push([x2, y2]); };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!dark(r, c)) continue;
    if (!dark(r - 1, c)) add(c, r, c + 1, r);
    if (!dark(r, c + 1)) add(c + 1, r, c + 1, r + 1);
    if (!dark(r + 1, c)) add(c + 1, r + 1, c, r + 1);
    if (!dark(r, c - 1)) add(c, r + 1, c, r);
  }
  const loops = [];
  while (out.size) {
    // aloitus pisteestä, jossa on vain yksi lähtevä reuna (ei kulmakosketuksesta), jos sellainen on
    let startKey = null;
    for (const [k, v] of out) { if (v.length === 1) { startKey = k; break; } }
    if (!startKey) [startKey] = out.keys();
    let [x, y] = startKey.split(',').map(Number);
    const pts = [[x, y]]; let dir = null;
    for (let guard = 0; guard < 4 * n * n + 8; guard++) {
      const k = `${x},${y}`; const opts = out.get(k);
      if (!opts) break;
      // kulmittain koskettavissa moduuleissa käännytään tumman puolelle (oikealle), jolloin silmukat eivät risteä
      let i = 0;
      if (opts.length > 1 && dir) {
        for (const p of [[-dir[1], dir[0]], dir, [dir[1], -dir[0]]]) { // oikealle, suoraan, vasemmalle
          const j = opts.findIndex((o) => o[0] - x === p[0] && o[1] - y === p[1]);
          if (j >= 0) { i = j; break; }
        }
      }
      const [nx, ny] = opts.splice(i, 1)[0];
      if (!opts.length) out.delete(k);
      dir = [nx - x, ny - y]; x = nx; y = ny;
      if (`${x},${y}` === startKey) break; // silmukka sulkeutui
      pts.push([x, y]);
    }
    // suorat jaksot yhdeksi viivaksi
    const simple = pts.filter((p, j) => {
      const a = pts[(j - 1 + pts.length) % pts.length]; const b = pts[(j + 1) % pts.length];
      return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
    });
    loops.push(simple);
  }
  return { n, loops };
}
function qrSvgFile(text, mm) {
  const qr = qrLib(0, 'M'); qr.addData(text); qr.make();
  const { n, loops } = qrOutline(qr); const m = 4; const total = n + 2 * m;
  const d = loops.map((l) => 'M' + l.map(([x, y]) => `${x + m} ${y + m}`).join('L') + 'Z').join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${mm}mm" height="${mm}mm" viewBox="0 0 ${total} ${total}">
  <!-- ${text} · ${n}x${n} moduulia + ${m} moduulin reunus · moduuli ${(mm / total).toFixed(3)} mm -->
  <path d="${d}" fill="#000" fill-rule="evenodd"/>
</svg>
`;
}
function downloadQrSvg(text, name) {
  const mm = Math.min(300, Math.max(10, Number((document.getElementById('aw-mm') || {}).value) || 40));
  const blob = new Blob([qrSvgFile(text, mm)], { type: 'image/svg+xml' });
  const link = document.createElement('a');
  link.download = `QR ${name.replace(/[\\/:*?"<>|]+/g, '')} ${mm}mm.svg`; link.href = URL.createObjectURL(blob);
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

// Tulostettava arkki: kaikki QR-koodit kategorioiden nimillä
function printQrSheet(items, title) {
  const w = window.open('', '_blank');
  if (!w) return toast('Salli ponnahdusikkunat tulostusta varten.', true);
  w.document.write(`<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:system-ui,sans-serif;margin:24px;color:#000}h1{font-size:18px;margin:0 0 16px}
    .g{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.i{border:1px dashed #999;padding:12px;text-align:center;break-inside:avoid}
    .i svg{width:42mm;height:42mm}.n{font-weight:600;margin-top:8px}.u{font-size:9px;color:#555;word-break:break-all}
    @media print{body{margin:10mm}}</style></head><body><h1>${esc(title)}</h1><div class="g">
    ${items.map((x) => `<div class="i">${qrSvg(awardUrl(x.token), 160)}<div class="n">${esc(x.name)}</div><div class="u">${esc(awardUrl(x.token))}</div></div>`).join('')}
    </div><script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>`);
  w.document.close();
}

function awardsPanel() {
  const A = state.admin.awards;
  if (!A || (!A.current.length && !A.archived.length)) return '';
  ensureQrLib();
  const placesTxt = (pl) => (pl.length ? pl.map((x) => `${x.place}. ${esc(x.name)}`).join(' · ') : '<span class="muted">Ei vielä sijoja (finaaliääniä ei ole).</span>');
  const item = (x, cur) => `
      <div class="award-item">
        <a href="${esc(awardUrl(x.token))}" target="_blank" rel="noopener" title="Avaa palkintosivu">${qrSvg(awardUrl(x.token))}</a>
        <div class="award-item-body">
          <h4 class="h3" style="margin:0">${esc(x.name)}</h4>
          <p class="small" style="margin:0">${placesTxt(x.places)}${cur && x.manual ? ' <span class="tag">käsin</span>' : ''}</p>
          <p class="small muted award-url" style="margin:0">${esc(awardUrl(x.token))}</p>
          <div class="row" style="gap:4px;flex-wrap:wrap;margin-left:-10px">
            <a class="btn btn--ghost" href="${esc(awardUrl(x.token))}" target="_blank" rel="noopener">Avaa sivu</a>
            <button class="btn btn--ghost" type="button" data-act="award-png" data-token="${x.token}" data-name="${esc(x.name)}">Lataa QR (PNG)</button>
            <button class="btn btn--ghost" type="button" data-act="award-svg" data-token="${x.token}" data-name="${esc(x.name)}">Lataa SVG (3D)</button>
            ${cur ? `<button class="btn btn--ghost" type="button" data-act="award-edit" data-id="${x.id}">${awardEdit === x.id ? 'Sulje sijat' : 'Muokkaa sijoja'}</button>` : ''}
          </div>
          ${cur && awardEdit === x.id ? `
          <div class="award-places-edit">
            ${x.finalists.map((f) => `<label class="row" style="gap:10px;align-items:center"><select class="input" style="max-width:110px" data-award-place="${f.id}">
              <option value="">–</option>${[1, 2, 3].map((pl) => `<option value="${pl}" ${(x.manual ? f.place : (x.places.find((p) => p.name === f.name) || {}).place) === pl ? 'selected' : ''}>${pl}. sija</option>`).join('')}</select>
              <span>${esc(f.name)} <span class="muted small">(${f.votes} ${f.votes === 1 ? 'ääni' : 'ääntä'})</span></span></label>`).join('')}
            <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn btn--secondary btn--sm" type="button" data-act="award-places-save" data-id="${x.id}">Tallenna sijat</button>
            ${x.manual ? `<button class="btn btn--ghost" type="button" data-act="award-places-reset" data-id="${x.id}">Laske äänistä</button>` : ''}</div>
          </div>` : ''}
        </div>
      </div>`;
  return `
    <div class="panel awards-panel">
      <p class="eyebrow">Palkintosivut ja QR-koodit</p>
      <p class="small" style="margin:0">Jokaisella kategorialla on oma palkintosivu, jonka QR-koodin voi tulostaa pokaalin pohjaan. Sivu näkyy ilman kirjautumista, mutta sinne ei ole linkkiä muualta sivustolta. Sijat 1.–3. tulevat finaalin äänistä (tasapelissä sama sija), ja niitä voi korjata käsin.</p>
      <div class="row award-publish" style="gap:12px;flex-wrap:wrap;align-items:center">
        <b class="${A.published ? 'notify-on' : 'notify-off'}">● ${A.published ? 'Tulokset näkyvät palkintosivuilla.' : 'Tulokset piilossa: sivuilla lukee "Voittaja julkistetaan Gaalassa".'}</b>
        <button class="btn btn--sm ${A.published ? 'btn--secondary' : 'btn--primary'}" type="button" data-act="awards-publish">${A.published ? 'Piilota tulokset' : 'Julkaise tulokset'}</button>
      </div>
      <form class="row award-base" id="award-base-form" style="gap:10px;flex-wrap:wrap;align-items:end">
        <div class="field" style="flex:1 1 280px"><label for="aw-base">QR-koodien osoite</label><input class="input" id="aw-base" value="${esc(A.baseUrl || location.origin)}" placeholder="https://…"><span class="small muted">Osoite, jolla sivu aukeaa kaikille (Funnelin osoite). Tarkista ennen tulostamista.</span></div>
        <button class="btn btn--ghost" type="submit">Tallenna osoite</button>
      </form>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:end">
        <div class="field" style="max-width:220px"><label for="aw-mm">SVG:n koko (mm)</label><input class="input" id="aw-mm" type="number" min="10" max="300" step="1" value="40" data-keep></div>
        <p class="small muted" style="margin:0;flex:1 1 260px">SVG on 3D-mallinnukseen (esim. Fusion 360: Insert → Insert SVG). Tummat ruudut ovat yhtenäisinä ääriviivoina, joten ne voi pursottaa suoraan. Koko sisältää 4 ruudun valkoisen reunuksen; jätä se tyhjäksi pokaalin pohjaan, jotta koodi lukeutuu.</p>
      </div>
      ${A.current.length ? `
      <div class="award-group">
        <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h3 class="h3" style="margin:0">Gaala ${new Date().getFullYear()}</h3>
          <span><button class="btn btn--ghost" type="button" data-act="award-print" data-year="">Tulosta kaikki QR-koodit</button><button class="btn btn--ghost" type="button" data-act="award-svg-all" data-year="">Lataa kaikki SVG:t</button></span></div>
        <div class="award-list">${A.current.map((x) => item(x, true)).join('')}</div>
      </div>` : ''}
      ${A.archived.map((y) => `
      <details class="award-group">
        <summary class="h3">Hall of Fame ${y.year} <span class="small muted">(${y.categories.length})</span></summary>
        <div class="row" style="justify-content:flex-end;flex-wrap:wrap"><button class="btn btn--ghost" type="button" data-act="award-print" data-year="${y.year}">Tulosta vuoden ${y.year} QR-koodit</button><button class="btn btn--ghost" type="button" data-act="award-svg-all" data-year="${y.year}">Lataa vuoden ${y.year} SVG:t</button></div>
        <div class="award-list">${y.categories.map((x) => item(x, false)).join('')}</div>
      </details>`).join('')}
    </div>`;
}

// ---------- Hall of Fame ----------
// Aiemmat Gaalat uusin ensin: jokaisesta kategoriasta voittaja isona korttina ja muut ehdokkaat pienempinä.
function hofView() {
  const s = state; const years = s.hallOfFame || []; const admin = s.me.admin && !s.me.tester;
  return `
  <section class="section hof">
    <header class="hero-head screen-center">
      <p class="eyebrow">Hall of Fame</p>
      <h1 class="h1">Edellisten vuosien voittajat</h1>
      <p class="lead">${years.length > 1 ? `HerrasmiesKlubi Gaala vuodesta ${years[years.length - 1].year} lähtien.` : 'Täällä elävät aiempien Gaalojen voittajat ja ehdokkaat.'}</p>
      <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap">${awardBack() ? `<a class="btn btn--primary btn--sm" href="${esc(awardBack())}">← Takaisin palkintosivulle</a>` : ''}<button class="btn btn--secondary btn--sm" data-act="hof-close">Takaisin Gaalaan</button></div>
    </header>
    ${admin && s.admin ? hofVisibility() : ''}
    ${years.length ? hofTabs(years) : `<div class="empty">${admin ? 'Hall of Fame on vielä tyhjä. Lisää viime vuoden Gaala alta.' : 'Hall of Fame julkaistaan myöhemmin.'}</div>`}
    ${admin ? hofAdmin() : ''}
  </section>`;
}

// Valittu vuosi: osoitteen vuosi, jos se on olemassa, muuten uusin
function hofSelected(years = state.hallOfFame || []) {
  return years.find((y) => y.year === hofYearSel) || years[0] || null;
}

// Vuodet välilehtinä (uusin ensin). Yhdellä vuodella välilehtiä ei tarvita.
function hofTabs(years) {
  const sel = hofSelected(years);
  if (years.length === 1) return hofYear(sel);
  return `
  <div class="tabs hof-tabs" role="tablist" aria-label="Gaalavuodet">
    ${years.map((y) => `<button type="button" role="tab" id="hof-tab-${y.year}" aria-controls="hof-panel" aria-selected="${y === sel}" tabindex="${y === sel ? 0 : -1}" data-act="hof-year" data-year="${y.year}">${y.year}</button>`).join('')}
  </div>
  <div id="hof-panel" role="tabpanel" aria-labelledby="hof-tab-${sel.year}">${hofYear(sel)}</div>`;
}

// Osoite seuraa Hall of Famea: #hall-of-fame tai #hall-of-fame/2025. Avaaminen lisää historiaan rivin, jotta
// selaimen takaisin-nappi palaa Gaalaan; vuoden vaihto vain korvaa osoitteen.
function hofHash() { return hofOpen ? `#hall-of-fame${hofYearSel ? '/' + hofYearSel : ''}` : ''; }
function syncHofUrl(push) {
  const url = location.pathname + location.search + hofHash();
  if (url === location.pathname + location.search + location.hash) return;
  history[push ? 'pushState' : 'replaceState'](null, '', url);
}
function readHofUrl() {
  const m = /^#hall-of-fame(?:\/(\d{4}))?$/.exec(location.hash);
  hofOpen = !!m;
  hofYearSel = m && m[1] ? Number(m[1]) : null;
  if (hofOpen) { photosOpen = false; meCard = false; previewVersion = null; }
}
readHofUrl();
window.addEventListener('popstate', () => { readHofUrl(); if (state) { render(); window.scrollTo(0, 0); } });

function hofYear(y) {
  const n = y.categories.length;
  return `
  <section class="hof-year" id="hof-${y.year}" aria-labelledby="hof-h-${y.year}">
    <header class="hof-year-head">
      <p class="eyebrow">${n} ${n === 1 ? 'kategoria' : 'kategoriaa'}</p>
      <h2 class="hof-year-title" id="hof-h-${y.year}">Gaala ${y.year}</h2>
    </header>
    ${y.cover && y.cover.photo ? `<figure class="hof-cover"><img src="${y.cover.photo.src}" alt="Gaala ${y.year}" loading="lazy" style="${cropStyle(y.cover.photo)}"></figure>` : ''}
    ${y.categories.map((c) => {
      const wins = c.nominees.filter((x) => x.winner);
      const rest = c.nominees.filter((x) => !x.winner).sort((a, b) => (a.place || 9) - (b.place || 9));
      return `
      <article class="hof-cat">
        <header class="cat-head">
          <h3 class="h2">${esc(c.name)}</h3>
          ${c.description ? `<p class="muted" style="margin:0">${esc(c.description)}</p>` : ''}
        </header>
        ${wins.length ? `<div class="final-grid">${wins.map((w) => `
          <div class="final-card hof-winner">
            ${portrait(w, 'final-photo')}
            <span class="final-body"><b>${esc(w.name)}</b>${w.reason ? `<span>${esc(w.reason)}</span>` : ''}</span>
            <span class="final-pick">★ ${wins.length > 1 ? 'Jaettu voitto' : 'Voittaja'}</span>
          </div>`).join('')}</div>` : ''}
        ${rest.length ? `<div class="hof-rest">
          <p class="eyebrow">${wins.length ? 'Muut ehdokkaat' : 'Ehdokkaat'}</p>
          <ul class="hof-noms">${rest.map((x) => `
            <li>${portrait(x, 'person-photo')}<span><b>${esc(x.name)}</b>${x.place ? ` <span class="place-tag place-${x.place}">${x.place}. sija</span>` : ''}${x.reason ? `<span class="small muted">${esc(x.reason)}</span>` : ''}</span></li>`).join('')}
          </ul>
        </div>` : ''}
      </article>`;
    }).join('')}
  </section>`;
}

// ---------- Hall of Fame -lomake ----------
// Luonnos pidetään muistissa ja päivitetään jokaisella näppäilyllä, joten taustapäivitys (render) ei hävitä sitä.
// key: rivin pysyvä tunniste (kuvan lataus osuu oikealle riville, vaikka rivejä poistettaisiin latauksen aikana)
const hofNominee = (n = {}) => ({ key: 'r' + Math.random().toString(36).slice(2, 10), personId: n.personId || '', name: n.name || '', reason: n.reason || '', place: n.place || (n.winner ? 1 : 0), other: !!(n.name && !n.personId), image: n.image || null, src: n.imageSrc || null, crop: n.crop || null });
const hofRow = (key) => { for (const c of hofDraft ? hofDraft.categories : []) for (const n of c.nominees) if (n.key === key) return n; return null; };
const hofCategory = (c = {}) => ({ name: c.name || '', description: c.description || '', awardToken: c.awardToken || null, nominees: c.nominees && c.nominees.length ? c.nominees.map(hofNominee) : [hofNominee(), hofNominee(), hofNominee()] });

function openHofDraft(id) {
  const y = (state.hallOfFame || []).find((x) => x.id === id);
  if (y) { hofDraft = { id: y.id, year: String(y.year), cover: y.cover ? { image: y.cover.image, src: y.cover.imageSrc, crop: y.cover.crop } : null, categories: y.categories.map(hofCategory), dirty: false }; return; }
  // Uusi: oletuksena viime vuosi, tai jos se on jo lisätty, vanhinta edeltävä vuosi
  const taken = (state.hallOfFame || []).map((x) => x.year);
  const year = (taken.length ? Math.min(...taken, new Date().getFullYear()) : new Date().getFullYear()) - 1;
  hofDraft = { id: null, year: String(year), cover: null, categories: [hofCategory()], dirty: false };
}

const hofPeople = () => (state.admin ? state.admin.participants.filter((p) => !p.tester).map((p) => ({ id: p.id, name: p.name, photo: p.shownPhoto })) : state.people || []);

function hofNomRow(n, ci, ni, people) {
  const k = `${ci}-${ni}`;
  const person = people.find((p) => p.id === n.personId);
  const label = person ? person.name : n.name;
  return `
  <div class="hof-edit-nom${n.place === 1 ? ' is-winner' : ''}" data-drop-target="hof" data-drop-id="${n.key}">
    <div class="hof-edit-pic">
      <button type="button" class="hof-pic-btn" data-act="photo-pick" data-target="hof" data-id="${n.key}" title="${n.src ? 'Vaihda kuva' : 'Lisää kuva'}" aria-label="${n.src ? 'Vaihda kuva' : 'Lisää kuva'}: ehdokas ${ni + 1}">
        ${n.src ? portrait({ name: label || '?', photo: { src: n.src, ...(n.crop || {}) } }, 'person-photo') : '<span class="person-photo hof-pic-empty" aria-hidden="true">+</span>'}
      </button>
      ${n.src ? `<button type="button" class="hof-pic-del" data-act="crop-open" data-target="hof" data-id="${n.key}">Rajaa</button><button type="button" class="hof-pic-del" data-act="hof-img-del" data-id="${n.key}">Poista</button>` : '<span class="hof-pic-hint" aria-hidden="true">Kuva</span>'}
    </div>
    <div class="hof-edit-who">
      <label class="sr-only" for="hp-${k}">Ehdokas ${ni + 1}</label>
      <select class="input" id="hp-${k}" data-hof="person" data-ci="${ci}" data-ni="${ni}">
        <option value="">Valitse henkilö…</option>
        ${people.map((p) => `<option value="${p.id}" ${p.id === n.personId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        <option value="__other" ${n.other ? 'selected' : ''}>Joku muu…</option>
      </select>
      ${n.other ? `<label class="sr-only" for="hn-${k}">Nimi</label><input class="input" id="hn-${k}" data-hof="name" data-ci="${ci}" data-ni="${ni}" value="${esc(n.name)}" maxlength="60" placeholder="Nimi">` : ''}
    </div>
    <label class="sr-only" for="hr-${k}">Mistä</label>
    <input class="input" id="hr-${k}" data-hof="reason" data-ci="${ci}" data-ni="${ni}" value="${esc(n.reason)}" maxlength="160" placeholder="Mistä? (valinnainen)">
    <label class="hof-win-toggle hof-place${n.place ? ' has-place' : ''}${n.place === 1 ? ' is-first' : ''}" title="Sija palkintosivulla (1. = voittaja)"><span aria-hidden="true">Sija</span>
      <select id="hw-${k}" data-hof="place" data-ci="${ci}" data-ni="${ni}" aria-label="Sija, ehdokas ${ni + 1}">
        <option value="">–</option>${[1, 2, 3].map((pl) => `<option value="${pl}" ${n.place === pl ? 'selected' : ''}>${pl === 1 ? '★ 1.' : pl + '.'}</option>`).join('')}
      </select></label>
    <button class="btn btn--ghost hof-x" type="button" data-act="hof-nom-del" data-ci="${ci}" data-ni="${ni}" aria-label="Poista ehdokas ${ni + 1}" title="Poista ehdokas">✕</button>
  </div>`;
}

// Kansikuva: näkyy vuoden otsikon alla. Lisätään kuten ehdokkaiden kuvat (klikkaus, raahaus, liittäminen).
function hofCoverEdit(d) {
  const c = d.cover;
  return `
    <div class="hof-cover-edit" data-drop-target="hofcover" data-drop-id="cover" tabindex="-1">
      <p class="small muted" style="margin:0">Kansikuva näkyy "Gaala ${esc(d.year)}" -otsikon alla (valinnainen). Klikkaa, raahaa kuva tähän tai klikkaa aluetta ja liitä kuva (Ctrl+V).</p>
      ${c && c.src
        ? `<div class="hof-cover hof-cover--edit"><img src="${c.src}" alt="" style="${cropStyle(c.crop || {})}"></div>
           <div class="item-actions">
             <button class="btn btn--ghost" type="button" data-act="photo-pick" data-target="hofcover" data-id="cover">Vaihda kuva</button>
             <button class="btn btn--ghost" type="button" data-act="crop-open" data-target="hofcover" data-id="cover">Rajaa</button>
             <button class="btn btn--ghost" type="button" data-act="hof-cover-del">Poista kuva</button>
           </div>`
        : `<button type="button" class="hof-cover-empty" data-act="photo-pick" data-target="hofcover" data-id="cover"><span aria-hidden="true">+</span> Lisää kansikuva</button>`}
    </div>`;
}

function hofForm() {
  const d = hofDraft; const people = hofPeople();
  return `
  <form class="panel hof-form" data-form="hof" novalidate>
    <div class="hof-form-head">
      <p class="eyebrow">${d.id ? 'Muokkaa Gaalaa' : 'Lisää aiempi Gaala'}</p>
      <div class="field hof-year-field"><label for="hof-year">Vuosi</label><input class="input" id="hof-year" data-hof="year" type="number" inputmode="numeric" min="2000" max="2100" value="${esc(d.year)}"></div>
    </div>
    ${hofCoverEdit(d)}
    ${d.categories.map((c, ci) => `
    <fieldset class="hof-edit-cat">
      <legend class="sr-only">Kategoria ${ci + 1}</legend>
      <div class="hof-edit-cat-head">
        <span class="eyebrow">Kategoria ${String(ci + 1).padStart(2, '0')}</span>
        ${d.categories.length > 1 ? `<button class="btn btn--ghost" type="button" data-act="hof-cat-del" data-ci="${ci}">Poista kategoria</button>` : ''}
      </div>
      <div class="form-row">
        <div class="field"><label for="hc-${ci}">Nimi</label><input class="input" id="hc-${ci}" data-hof="cat-name" data-ci="${ci}" value="${esc(c.name)}" maxlength="80" placeholder="Esim. Vuoden sykähdyttävin hetki"></div>
        <div class="field"><label for="hd-${ci}">Kuvaus (valinnainen)</label><input class="input" id="hd-${ci}" data-hof="cat-desc" data-ci="${ci}" value="${esc(c.description)}" maxlength="200" placeholder="Lyhyt selitys"></div>
      </div>
      <div class="hof-edit-noms">
        <p class="small muted" style="margin:0">Ehdokkaat · rastita voittaja (tasapelissä useampi). Kuva on Hall of Famen oma, ei osallistujan profiilikuva: klikkaa pyöreää kuvaa, raahaa kuva riville tai klikkaa riviä ja liitä kuva (Ctrl+V).</p>
        ${c.nominees.map((n, ni) => hofNomRow(n, ci, ni, people)).join('')}
        <div><button class="btn btn--ghost" type="button" data-act="hof-nom-add" data-ci="${ci}">+ Lisää ehdokas</button></div>
      </div>
    </fieldset>`).join('')}
    <div><button class="btn btn--secondary btn--sm" type="button" data-act="hof-cat-add">+ Lisää kategoria</button></div>
    <div class="edit-actions hof-form-actions">
      <button class="btn btn--primary btn--sm" type="submit">Tallenna Gaala</button>
      <button class="btn btn--ghost" type="button" data-act="hof-edit-cancel">Peruuta</button>
      ${d.id ? `<button class="btn btn--ghost" type="button" data-act="hof-del" data-id="${d.id}">Poista vuosi</button>` : ''}
    </div>
  </form>`;
}

function hofAdmin() {
  const s = state; const years = s.hallOfFame || [];
  const thisYear = new Date().getFullYear();
  const archived = years.some((y) => y.year === thisYear);
  return `
  <div class="admin hof-admin">
    <header class="cat-head"><p class="eyebrow">Vain järjestäjille</p><h2 class="h2">Hall of Famen hallinta</h2></header>
    ${s.realPhase === 6 && !archived ? `<div class="panel">
      <p class="eyebrow">Tämän vuoden tulokset</p>
      <p style="margin:0">Äänestys on suljettu. Lisää vuoden ${thisYear} finalistit ja voittajat Hall of Fameen. Tee tämä ennen kuin nollaat Gaalan ensi vuotta varten.</p>
      <div><button class="btn btn--primary btn--sm" data-act="hof-archive" data-year="${thisYear}">Lisää Gaala ${thisYear} Hall of Fameen</button></div>
    </div>` : ''}
    ${hofDraft ? hofForm() : `<div class="item-actions">
      <button class="btn btn--secondary btn--sm" data-act="hof-edit" data-id="new">+ Lisää aiempi Gaala</button>
      ${years.map((y) => `<button class="btn btn--ghost" data-act="hof-edit" data-id="${y.id}">Muokkaa ${y.year}</button>`).join('')}
    </div>`}
  </div>`;
}

// Yläpalkin "Ehdota profiilikuvia" -nappi. Adminille näytetään odottavien ehdotusten määrä.
function suggestButton() {
  const n = state.me.admin ? state.photoNew || 0 : 0; // adminille: uudet ehdotukset edellisen käynnin jälkeen
  return `<button class="btn btn--ghost suggest-btn${photosOpen ? ' is-open' : ''}" data-act="${photosOpen ? 'photos-close' : 'photos-open'}" aria-pressed="${photosOpen}"><span class="long-label">Ehdota profiilikuvia</span><span class="short-label" aria-hidden="true">Ehdota kuvia</span>${n ? ` <span class="count-badge" aria-label="${n} uutta ehdotusta">${n}</span>` : ''}</button>`;
}

// Discord-ilmoitukset: palvelin lähettää tapahtumat adminien Discord-kanavalle webhookin kautta.
// Webhook-osoite on salaisuus: se tallennetaan palvelimelle eikä sitä koskaan näytetä takaisin selaimessa.
const NOTIFY_LABELS = { errors: 'Virheet (kuvalataukset, palvelinvirheet)', requests: 'Lukon avauspyynnöt', locks: 'Lukitukset ja "kaikki lukinneet"', phases: 'Vaiheen vaihtuminen', feedback: 'Palautteet (kirjoittajan nimellä)', photos: 'Kuvaehdotukset', reminders: 'Muistutukset lukitsemattomista' };
function notifyPanel() {
  const n = state.admin.notify || { set: false, kinds: {}, reminderTime: '18:00' };
  return `
    <form class="panel notify-panel" id="notify-form">
      <p class="eyebrow">Discord-ilmoitukset</p>
      <p class="small" style="margin:0">${n.set
        ? `<b class="notify-on">● Käytössä.</b> ${n.fromEnv ? 'Webhook tulee palvelimen ympäristömuuttujasta (DISCORD_WEBHOOK).' : 'Webhook on tallennettu palvelimelle.'}`
        : '<b class="notify-off">● Pois päältä.</b> Liitä alle Discord-kanavan webhook-osoite (kanavan asetukset → Integraatiot → Webhookit).'}</p>
      <div class="field"><label for="n-url">${n.set ? 'Vaihda webhook-osoite' : 'Webhook-osoite'}</label>
        <input class="input" id="n-url" type="password" autocomplete="off" spellcheck="false" placeholder="https://discord.com/api/webhooks/…" data-keep>
        <span class="small muted">Osoite on salaisuus: kuka tahansa, jolla se on, voi lähettää kanavalle. Sitä ei näytetä täällä tallennuksen jälkeen.</span></div>
      <fieldset class="notify-kinds"><legend class="small muted">Ilmoitukset</legend>
        ${Object.entries(NOTIFY_LABELS).map(([k, label]) => `<label class="check small"><input type="checkbox" id="n-k-${k}" ${n.kinds[k] !== false ? 'checked' : ''}> ${label}</label>`).join('')}
      </fieldset>
      <div class="field"><label for="n-time">Päivittäinen muistutus klo</label><input class="input" id="n-time" type="time" style="max-width:200px" value="${esc(n.reminderTime || '')}"><span class="small muted">Lukitsemattomien lista kerran päivässä vaiheissa 1–4. Tyhjä = ei päivittäistä muistutusta. Lisäksi muistutus 24 h ja 2 h ennen vaiheen päättymistä sekä päättymisen jälkeen.</span></div>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <button class="btn btn--secondary btn--sm" type="submit">Tallenna ilmoitusasetukset</button>
        ${n.set ? '<button class="btn btn--ghost" type="button" data-act="notify-test">Lähetä testiviesti</button>' : ''}
        ${n.set && !n.fromEnv ? '<button class="btn btn--ghost" type="button" data-act="notify-remove">Poista webhook</button>' : ''}
      </div>
    </form>`;
}

// Discordin muotoilun yksinkertainen esitys esikatselua varten: **lihavointi**, *kursiivi*, "-# " pieni teksti, roolimaininta
function discordMd(text) {
  return text.split('\n').map((line) => {
    const small = line.startsWith('-# ');
    const li = !small && line.startsWith('- ');
    let h = esc(small ? line.slice(3) : li ? line.slice(2) : line)
      // Discordin \-suojatut merkit (esim. \* nimessä) näkyvät sellaisinaan eivätkä muotoile tekstiä
      .replace(/\\([\\*_~`|>#[\]()-])/g, (m, c) => `&#${c.charCodeAt(0)};`)
      .replace(/&lt;@&amp;\d+&gt;/g, '<span class="dc-mention">@Gaala-jäsenet</span>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>');
    if (li) return `<span class="dc-li">${h}</span>`;
    return small ? `<small class="dc-sub">${h}</small>` : h;
  }).join('<br>');
}

// Julkinen päivittäinen tiedote osallistujien Discord-kanavalle (oma webhook): lukitustilanne ja aikaa jäljellä.
let bulletinPreview = null; // esikatseltava tiedoteteksti
function bulletinPanel() {
  const b = state.admin.bulletin || { set: false, roleId: '', time: '12:00' };
  return `
    <form class="panel notify-panel" id="bulletin-form">
      <p class="eyebrow">Julkinen päivittäinen tiedote</p>
      <p class="small" style="margin:0">${b.set
        ? `<b class="notify-on">● Käytössä.</b> Tiedote lähtee osallistujien kanavalle ${b.time ? `joka päivä klo ${esc(b.time)}` : 'vain käsin (kellonaika tyhjä)'} vaiheissa 1–5.${b.lastSent ? ` Viimeksi lähetetty ${fmtTime(b.lastSent)}.` : ''}`
        : '<b class="notify-off">● Pois päältä.</b> Virallinen kaksikielinen tiedote osallistujien kanavalle: montako on lyönyt vaiheen lukkoon, ketkä eivät vielä ole ja paljonko aikaa on jäljellä.'}</p>
      <div class="field"><label for="b-url">${b.set ? 'Vaihda osallistujien kanavan webhook' : 'Osallistujien kanavan webhook-osoite'}</label>
        <input class="input" id="b-url" type="password" autocomplete="off" spellcheck="false" placeholder="https://discord.com/api/webhooks/…" data-keep>
        <span class="small muted">Eri webhook kuin adminien ilmoituksissa: tee se kanavalle, jonka gaalaosallistujat näkevät.</span></div>
      <div class="bulletin-grid">
        <div class="field"><label for="b-role">Pingattavan roolin ID (valinnainen)</label>
          <input class="input" id="b-role" inputmode="numeric" autocomplete="off" value="${esc(b.roleId || '')}" placeholder="esim. 1234567890123456789">
          <span class="small muted">Esim. @Gaala-jäsenet. Discord: Asetukset → Lisäasetukset → Kehittäjätila päälle, sitten Palvelimen asetukset → Roolit → roolin ⋯ → Kopioi roolin ID. Tyhjä = ei pingiä, tekstissä lukee "Gaala-jäsenet".</span></div>
        <div class="field"><label for="b-time">Lähetysaika joka päivä klo</label>
          <input class="input" id="b-time" type="time" style="max-width:200px" value="${esc(b.time || '')}">
          <span class="small muted">Tyhjä = ei automaattista lähetystä, vain "Lähetä nyt".</span></div>
        <label class="check small" style="grid-column:1/-1"><input type="checkbox" id="b-names" ${b.names !== false ? 'checked' : ''}> Listaa tiedotteessa lukitsemattomien nimet (ei, jos kukaan ei ole vielä lukinnut)</label>
        <fieldset class="bskip" style="grid-column:1/-1">
          <legend class="small">Ei mukana tiedotteessa</legend>
          <p class="small muted" style="margin:0">Esim. adminit, jotka ehdottavat mutta eivät äänestä. Valitut eivät näy tiedotteen lukumäärissä ("7/12 jäsentä") eivätkä nimilistassa. Adminien kanavan muistutuksiin tämä ei vaikuta.</p>
          <div class="bskip-list">${state.admin.participants.filter((p) => !p.tester).map((p) => `<label class="check small"><input type="checkbox" data-bskip="${p.id}" ${(b.skip || []).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
        </fieldset>
      </div>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <button class="btn btn--secondary btn--sm" type="submit">Tallenna tiedoteasetukset</button>
        <button class="btn btn--ghost" type="button" data-act="bulletin-preview">Esikatsele</button>
        ${b.set ? '<button class="btn btn--ghost" type="button" data-act="bulletin-send">Lähetä nyt</button><button class="btn btn--ghost" type="button" data-act="bulletin-remove">Poista webhook</button>' : ''}
      </div>
      ${bulletinPreview !== null ? `<div class="bulletin-preview"><p class="small muted" style="margin:0 0 8px">Esikatselu suunnilleen niin kuin se näkyy Discordissa:</p><div class="bulletin-text">${discordMd(bulletinPreview)}</div></div>` : ''}
    </form>`;
}

// Alle K18 -kytkin: päällä ollessa kaikille näytetään profiilikuvien sijaan erikseen valitut <18-kuvat.
function k18Panel() {
  const a = state.admin; const on = !!a.safeMode;
  const ppl = a.participants.filter((p) => !p.tester); const chosen = ppl.filter((p) => p.safePhoto).length;
  return `
      <div class="panel k18-panel${on ? ' is-on' : ''}">
        <p class="eyebrow">Profiilikuvat</p>
        <button class="btn ${on ? 'btn--primary' : 'btn--secondary'} k18-btn" data-act="safe-mode" aria-pressed="${on}">ALLE K18 · ${on ? 'PÄÄLLÄ' : 'POIS'}</button>
        <p class="small muted" style="margin:0">${on ? 'Kaikille näytetään &lt;18-kuvat. Jos &lt;18-kuvaa ei ole valittu, näytetään nimikirjain.' : 'Kun päällä, profiilikuvien tilalla näytetään erikseen valitut &lt;18-kuvat.'} Valittu: <b style="color:var(--gold-light);font-weight:500">${chosen} / ${ppl.length}</b></p>
        <div><button class="btn btn--ghost" data-act="photos-open">Valitse &lt;18-kuvat</button></div>
      </div>`;
}

// Profiilikuvaehdotukset: kaikkien ehdokaskortit. Kuka tahansa voi ehdottaa kuvaa mihin tahansa korttiin.
// Osallistuja näkee omat ehdotuksensa. Admin näkee jokaisen henkilön kaikki kuvaversiot (ehdotukset, hallinnasta
// lisätyt ja aiemmat profiilikuvat) ja voi vaihtaa profiilikuvan niiden välillä; vanha kuva jää aina talteen.
function photosView() {
  const s = state; const admin = s.me.admin;
  const all = s.photoSuggestions || [];
  const people = admin && s.admin ? s.admin.participants.filter((p) => !p.tester) : s.people || [];
  const who = (x) => {
    if (!admin) return 'Sinun ehdotuksesi';
    if (x.source === 'previous') return 'Aiempi profiilikuva';
    if (x.source === 'admin') return `Lisätty hallinnasta${x.byName ? ` · ${esc(x.byName)}` : ''}`;
    return `<b>${esc(x.byName || 'Poistettu osallistuja')}</b>`;
  };
  const item = (x) => `
    <li class="sugg-item${x.current ? ' is-current' : ''}">
      <button type="button" class="sugg-thumb" data-act="version-preview" data-id="${x.id}" aria-label="Esikatsele kuva" title="Esikatsele"><img src="${x.src}" alt="" loading="lazy"></button>
      <div class="sugg-meta">
        <span class="small">${who(x)}</span>
        <span class="small muted">${fmtTime(x.createdAt)}${x.withdrawn ? ' · ehdottaja perui' : ''}</span>
        ${x.current || x.safe ? `<span class="sugg-tags">${x.current ? '<span class="tag tag--gold">Käytössä</span>' : ''}${x.safe ? '<span class="tag tag--k18">&lt;18-kuva</span>' : ''}</span>` : ''}
        <div class="sugg-actions">
          ${admin && !x.current ? `<button class="btn btn--ghost" data-act="sugg-accept" data-id="${x.id}">Käytä</button>` : ''}
          ${admin ? `<button class="btn btn--ghost" data-act="sugg-safe" data-id="${x.id}">${x.safe ? 'Poista &lt;18' : 'Käytä &lt;18'}</button>` : ''}
          ${(admin || x.mine) && !x.current && !x.safe ? `<button class="btn btn--ghost" data-act="sugg-del" data-id="${x.id}">Poista</button>` : ''}
        </div>
      </div>
    </li>`;
  // Käytössä oleva ensin, sitten uusimmat
  const order = (a, b) => (b.current - a.current) || String(b.createdAt).localeCompare(String(a.createdAt));
  return `
  <section class="section photos-view">
    <header class="hero-head screen-center">
      <p class="eyebrow">Profiilikuvat</p>
      <h1 class="h1">Ehdota profiilikuvia</h1>
      <p class="lead">${admin
        ? `Avaa kortin "Kuvaversiot" nähdäksesi kaikki henkilön kuvat. Klikkaa kuvaa esikatsellaksesi sitä. "Käytä" vaihtaa normaalin profiilikuvan ja "Käytä &lt;18" valitsee kuvan, joka näytetään Alle K18 -tilassa.${s.admin && s.admin.safeMode ? ' Alle K18 -tila on nyt päällä, joten korteissa näkyvät &lt;18-kuvat.' : ''}`
        : 'Lähetä kuva, joka sopisi kaverin ehdokaskorttiin. Järjestäjät valitsevat, mitä kuvia käytetään.'}</p>
      <div><button class="btn btn--secondary btn--sm" data-act="photos-close">Takaisin Gaalaan</button></div>
    </header>
    ${people.length ? `<div class="nom-grid sugg-grid">
      ${people.map((p) => {
        const list = all.filter((x) => x.personId === p.id).sort(order);
        const tag = !list.length ? '' : admin ? `${list.length} ${list.length === 1 ? 'kuva' : 'kuvaa'}` : `${list.length} ${list.length === 1 ? 'ehdotus' : 'ehdotusta'}`;
        return `
        <article class="nom-card sugg-card" id="sugg-${p.id}" data-drop-target="sugg" data-drop-id="${p.id}">
          <div class="nom-media">${portrait('shownPhoto' in p ? { ...p, photo: p.shownPhoto } : p)}${tag ? `<span class="tag nom-tag">${tag}</span>` : ''}</div>
          <div class="nom-body"><h3 class="h3">${esc(p.name)}</h3></div>
          ${list.length ? `<button type="button" class="btn btn--ghost versions-toggle" data-act="versions-toggle" data-id="${p.id}" aria-expanded="${versionsOpen.has(p.id)}" aria-controls="vers-${p.id}">${admin ? 'Kuvaversiot' : 'Omat ehdotukset'} (${list.length}) <span class="chev" aria-hidden="true">${versionsOpen.has(p.id) ? '▴' : '▾'}</span></button>` : ''}
          ${list.length && versionsOpen.has(p.id) ? `<ul class="sugg-list" id="vers-${p.id}">${list.map(item).join('')}</ul>` : ''}
          <button class="btn btn--sm btn--secondary" type="button" data-act="photo-pick" data-target="sugg" data-id="${p.id}">Ehdota kuvaa</button>
        </article>`;
      }).join('')}
    </div>` : '<div class="empty">Ei vielä ehdokkaita.</div>'}
  </section>`;
}

// Kuvaversion esikatselu: kortti sellaisena kuin muut sen näkisivät + koko kuva rajaamattomana.
// Nuolilla voi selata saman henkilön versioita; admin voi ottaa kuvan käyttöön suoraan tästä.
function versionList(personId) {
  return (state.photoSuggestions || []).filter((x) => x.personId === personId)
    .sort((a, b) => (b.current - a.current) || String(b.createdAt).localeCompare(String(a.createdAt)));
}
function versionPreview() {
  const s = state; const admin = s.me.admin;
  const x = (s.photoSuggestions || []).find((y) => y.id === previewVersion);
  if (!x) return '';
  const list = versionList(x.personId); const i = list.findIndex((y) => y.id === x.id);
  const person = (admin && s.admin ? s.admin.participants : s.people || []).find((p) => p.id === x.personId) || { name: '' };
  const photo = { src: x.src, ...(x.crop || { x: 50, y: 50, z: 1 }) };
  const origin = !admin ? 'Sinun ehdotuksesi' : x.source === 'previous' ? 'Aiempi profiilikuva' : x.source === 'admin' ? `Lisätty hallinnasta${x.byName ? ` · ${x.byName}` : ''}` : `Ehdottaja: ${x.byName || 'poistettu osallistuja'}`;
  return `
  <div class="crop-overlay preview-overlay" role="dialog" aria-modal="true" aria-labelledby="pv-h">
    <div class="crop-dialog panel preview-dialog">
      <p class="eyebrow" id="pv-h">Esikatselu · ${esc(person.name)}${list.length > 1 ? ` · ${i + 1} / ${list.length}` : ''}</p>
      <p class="small muted" style="margin:0">${esc(origin)} · ${fmtTime(x.createdAt)}${x.withdrawn ? ' · ehdottaja perui' : ''}</p>
      <div class="preview-row">
        ${list.length > 1 ? `<button class="btn btn--ghost preview-nav" data-act="version-step" data-step="-1" aria-label="Edellinen kuva">‹</button>` : ''}
        <div class="crop-previews">
          <article class="nom-card crop-card">
            <div class="nom-media">${portrait({ name: person.name, photo })}${x.current || x.safe ? `<span class="tag nom-tag">${[x.current ? 'Käytössä' : '', x.safe ? '&lt;18-kuva' : ''].filter(Boolean).join(' · ')}</span>` : ''}</div>
            <div class="nom-body"><h3 class="h3">${esc(person.name)}</h3><p>Ehdokaskortti</p></div>
          </article>
          <figure class="preview-full"><img src="${x.src}" alt="Koko kuva"><figcaption class="small muted">Koko kuva${x.crop ? '' : ' · rajaus säädetään käyttöönoton jälkeen'}</figcaption></figure>
        </div>
        ${list.length > 1 ? `<button class="btn btn--ghost preview-nav" data-act="version-step" data-step="1" aria-label="Seuraava kuva">›</button>` : ''}
      </div>
      <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap">
        ${admin && !x.current ? `<button class="btn btn--primary btn--sm" data-act="sugg-accept" data-id="${x.id}">Käytä tätä kuvaa</button>` : ''}
        ${admin ? `<button class="btn btn--secondary btn--sm" data-act="sugg-safe" data-id="${x.id}">${x.safe ? 'Poista &lt;18-valinta' : 'Käytä &lt;18-kuvana'}</button>` : ''}
        <button class="btn btn--secondary btn--sm" data-act="preview-close">Sulje</button>
      </div>
    </div>
  </div>`;
}

// Käyttäjäkortti: sama pystykortti kuin ehdokkailla, rajaus mukana. Sulkeutuu napista, taustasta tai Escillä.
function meCardView() {
  const me = state.me;
  return `
  <div class="crop-overlay me-overlay" role="dialog" aria-modal="true" aria-labelledby="me-card-h">
    <article class="nom-card me-card">
      <div class="nom-media">${portrait(me)}</div>
      <div class="nom-body"><h2 class="h3" id="me-card-h">${esc(me.name)}</h2></div>
      <button class="btn btn--sm btn--secondary" data-act="me-close">Sulje</button>
    </article>
  </div>`;
}

const STEP_NAMES = ['Ehdotukset', 'Kategoriat', 'Ehdokkaat', 'Top 3', 'Finaali', 'Suljettu'];
const LAST_OPEN = 5; // viimeinen vaihe, jossa äänestetään (6 = suljettu)
function stepper() {
  const names = STEP_NAMES;
  return `<ol class="stepper">${names.map((n, i) => {
    const p = i + 1; const cls = p < state.phase ? 'done' : p === state.phase ? 'now' : '';
    const end = p <= LAST_OPEN && state.phaseEnds && state.phaseEnds[p];
    // Päättymisaika näkyy vaiheiden välisellä viivalla (puhelimessa nimen alla)
    const endTxt = end ? `<span class="step-end">${p < state.phase ? 'päättyi' : 'päättyy'} <time datetime="${esc(end)}">${fmtEndParts(end)}</time></span>` : '';
    return `<li class="${cls}${end ? ' has-end' : ''}" ${p === state.phase ? 'aria-current="step"' : ''}>${p <= LAST_OPEN ? 'Vaihe ' + p : 'Lopuksi'}<b>${n}</b>${endTxt}</li>`;
  }).join('')}</ol>`;
}

function pips(used, total) {
  return `<span class="pips" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('')}</span>`;
}

// Päättymisaika muodossa "pe 4.12. klo 20.00"
function fmtEnd(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Vaihepalkkiin päivä ja kellonaika erikseen, jotta ne mahtuvat puhelimessa omille riveilleen
function fmtEndParts(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  const date = d.toLocaleDateString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric' });
  const time = d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
  return `<span>${esc(date)}</span> <span>klo ${esc(time)}</span>`;
}

function deadline() {
  const end = state.phaseEnds && state.phaseEnds[state.phase];
  const txt = end ? fmtEnd(end) : state.deadline; // vanha vapaatekstikenttä varalla
  return txt ? `<span class="small muted">Vaihe päättyy: <b style="color:var(--ink);font-weight:500">${esc(txt)}</b></span>` : '';
}

function phaseHero() {
  const s = state; const L = s.limits;
  if (s.phase === 1) {
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 1 / 5 · Kategoriaehdotukset</p>
      <h1 class="h1">Mistä palkintoja jaetaan?</h1>
      <p class="lead">Ehdota kategorioita, joista Gaalassa voisi jakaa palkinnon. Voit ehdottaa enintään ${L.maxCategoryProposals} kategoriaa. Ehdotukset eivät ole ääniä: seuraavassa vaiheessa kaikki äänestävät, mitkä kategoriat pääsevät Gaalaan.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(s.used.catProposals, L.maxCategoryProposals)} Ehdotuksia käytetty ${s.used.catProposals} / ${L.maxCategoryProposals}</span>${deadline()}</div>`;
  }
  if (s.phase === 2) {
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 2 / 5 · Kategoria-äänestys</p>
      <h1 class="h1">Mitkä kategoriat Gaalaan?</h1>
      <p class="lead">Gaalassa jaetaan ${L.targetCategories} palkintoa. ”Vuoden sykähdyttävin hetki” on mukana joka tapauksessa, ja loput ${L.advanceCount} valitaan äänestämällä. Sinulla on ${L.catVotes} ääntä, enintään yksi per kategoria.</p>
      <p class="notice"><b>Äänestä vähintään yhtä kategoriaa</b> ennen kuin lukitset vastauksesi.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(s.used.catVotes, L.catVotes)} Ääniä käytetty ${s.used.catVotes} / ${L.catVotes}</span>${deadline()}</div>`;
  }
  if (s.phase === 3) {
    const mine = s.nominees.filter((n) => n.mine).length;
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 3 / 5 · Ehdokasehdotukset</p>
      <h1 class="h1">Keitä palkitaan?</h1>
      <p class="lead">Kategoriat on valittu. Ehdota henkilöitä valitsemalla kortti ja kirjoittamalla mistä (enintään ${L.maxNomineeProposals} per kategoria). Saman henkilön voi ehdottaa useammasta eri aiheesta.</p>
      <p class="notice">Tässä vaiheessa vain ehdotetaan. <b>Äänestys on seuraava vaihe:</b> silloin jokainen valitsee kustakin kategoriasta oman top 3:nsa, ja eniten pisteitä saaneet pääsevät finaaliin.</p>
    </div>
    <div class="meta-row"><span class="meter">Ehdotuksiasi yhteensä ${mine}</span>${deadline()}</div>`;
  }
  if (s.phase === 4) {
    const need = rankProgress(); const done = need.filter((x) => x.have >= x.need).length;
    const [p1, p2, p3] = L.rankPoints || [3, 2, 1];
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 4 / 5 · Ehdokasäänestys</p>
      <h1 class="h1">Kuka finaaliin?</h1>
      <p class="lead">Valitse jokaisesta kategoriasta oma top 3:si: 1. sija saa ${p1} pistettä, 2. sija ${p2} ja 3. sija ${p3}. Kunkin kategorian ${L.finalists} eniten pisteitä saanutta pääsevät finaaliin.</p>
      <p class="notice"><b>Jaa kaikki sijat jokaisessa kategoriassa</b> ennen kuin lukitset vastauksesi.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(done, need.length)} Valmiina ${done} / ${need.length} kategoriaa</span>${deadline()}</div>`;
  }
  if (s.phase === 5) {
    const cats = s.categories; const done = cats.filter((c) => s.nominees.some((n) => n.categoryId === c.id && n.myFinal)).length;
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 5 / 5 · Finaali</p>
      <h1 class="h1">Valitse voittajat</h1>
      <p class="lead">Valitse kortti jokaisesta kategoriasta – yksi ääni per kategoria. Voit vaihtaa valintaasi, kunnes lukitset vastauksesi. Lukitseminen vaatii vähintään yhden äänen.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(done, cats.length)} Äänestetty ${done} / ${cats.length} kategoriaa</span>${deadline()}</div>`;
  }
  return `<div class="hero-head screen-center">
    <p class="eyebrow">Äänestys päättyi</p>
    <h1 class="display">Äänestys on suljettu</h1>
    <p class="lead">Kiitos äänistä! Voittajat julkistetaan Gaalassa.</p>
  </div>`;
}

// Osallistuja on lukinnut tämän vaiheen, eikä seuraava ole vielä alkanut
function isWaiting() {
  return !!(state.me && !state.me.root && state.me.locked && state.phase <= LAST_OPEN);
}

function phaseBody() {
  if (isWaiting()) return waitingView();
  if (state.phase === 1) return phaseProposals() + lockBar();
  if (state.phase === 2) return phaseCategoryVote() + lockBar();
  if (state.phase === 3) return phaseNominees() + lockBar();
  if (state.phase === 4) return phaseRanking() + lockBar();
  if (state.phase === 5) return phaseFinal() + lockBar();
  return feedbackView();
}

// ---------- Testikäyttäjä ----------
// Testikäyttäjä voi hypätä mihin tahansa vaiheeseen ja kokeilla kaikkea. Toiminnot tehdään vain tässä
// selaimessa (simulate), eikä palvelin tallenna mitään (palvelin myös hylkää testikäyttäjän muutokset).
function testBar() {
  const names = STEP_NAMES;
  return `
  <div class="test-bar"><div class="wrap">
    <div class="test-info"><span class="tag tag--red">Testitila</span><span class="small">Muutoksia ei tallenneta · oikea vaihe ${state.realPhase}</span></div>
    <div class="test-phases">${names.map((n, i) => `<button class="btn btn--sm ${i + 1 === state.phase && !state.me.locked ? 'btn--primary' : 'btn--secondary'}" data-act="test-phase" data-phase="${i + 1}">${i + 1}. ${n}</button>`).join('')}</div>
    <div class="test-phases test-waits"><span class="small">Odotusnäyttö:</span>${[1, 2, 3, 4, 5].map((p) => `<button class="btn btn--sm ${p === state.phase && state.me.locked ? 'btn--primary' : 'btn--secondary'}" data-act="test-wait" data-phase="${p}" title="Vaiheen ${p} odotusnäyttö (lukittu)">${p}</button>`).join('')}</div>
    <div class="test-tools">${state.me.locked ? '<button class="btn btn--ghost" data-act="test-unlock">Avaa lukko</button>' : ''}<button class="btn btn--ghost" data-act="test-reset">Aloita alusta</button></div>
  </div></div>`;
}

const tid = () => 't' + Math.random().toString(36).slice(2, 10);

// Samat lukitusehdot kuin palvelimella, laskettuna paikallisesta kokeilusta
function simLockReady() {
  const s = state;
  if (s.phase === 2 && !s.categories.some((c) => c.myVote)) return { ok: false, reason: 'Äänestä vähintään yhtä kategoriaa ennen lukitsemista.' };
  if (s.phase === 4) {
    const miss = rankProgress().filter((x) => x.have < x.need);
    if (miss.length) return { ok: false, reason: `Jaa kaikki sijat ennen lukitsemista. Puuttuu: ${miss.map((x) => `${x.cat.name} (${x.have}/${x.need})`).join(', ')}.` };
  }
  if (s.phase === 5 && !s.nominees.some((n) => n.myFinal)) return { ok: false, reason: 'Äänestä vähintään yhtä finalistia ennen lukitsemista.' };
  return { ok: true, reason: '' };
}

function simulate(act, d = {}) {
  const s = state; const L = s.limits; const fail = (m) => { toast(m, true); return false; };
  switch (act) {
    case 'vote-cat': {
      const c = s.categories.find((x) => x.id === d.id); if (!c || c.fixed) return false;
      if (!c.myVote && s.used.catVotes >= L.catVotes) return fail(`Olet käyttänyt kaikki ${L.catVotes} ääntäsi. Poista ääni toisesta kategoriasta ensin.`);
      c.myVote = !c.myVote; s.used.catVotes += c.myVote ? 1 : -1; break;
    }
    case 'rank': {
      const n = s.nominees.find((x) => x.id === d.id); if (!n) return false;
      s.myRanks = s.myRanks || {};
      s.myRanks[n.categoryId] = applyRank(myRanking(n.categoryId), n.id, d.place);
      break;
    }
    case 'final': { const n = s.nominees.find((x) => x.id === d.id); if (!n) return false; s.nominees.forEach((x) => { if (x.categoryId === n.categoryId) x.myFinal = x.id === n.id; }); break; }
    case 'lock': { const r = simLockReady(); if (!r.ok) return fail(r.reason); s.me.locked = true; break; }
    case 'unlock': s.me.locked = false; break;
    case 'add-cat': {
      if (s.used.catProposals >= L.maxCategoryProposals) return fail(`Voit ehdottaa enintään ${L.maxCategoryProposals} kategoriaa.`);
      if (d.name.length < 3) return fail('Kategorian nimi on liian lyhyt.');
      s.categories.push({ id: tid(), name: d.name, description: d.description, fixed: false, advanced: false, mine: true, myVote: false });
      s.used.catProposals++; break;
    }
    case 'add-nom': {
      const p = (s.people || []).find((x) => x.id === d.personId); if (!p) return false;
      if (d.reason.length < 3) return fail('Kirjoita myös mistä ehdotat.');
      if (s.nominees.filter((n) => n.categoryId === d.categoryId && n.mine).length >= L.maxNomineeProposals) return fail(`Voit ehdottaa enintään ${L.maxNomineeProposals} ehdokasta per kategoria.`);
      s.nominees.push({ id: tid(), categoryId: d.categoryId, personId: p.id, name: p.name, reason: d.reason, photo: p.photo, finalist: false, mine: true, myFinal: false });
      break;
    }
    case 'del': {
      if (d.kind === 'cat') { s.categories = s.categories.filter((c) => c.id !== d.id); s.used.catProposals = s.categories.filter((c) => c.mine).length; }
      else {
        const n = s.nominees.find((x) => x.id === d.id);
        s.nominees = s.nominees.filter((x) => x.id !== d.id);
        if (n && s.myRanks && s.myRanks[n.categoryId]) s.myRanks[n.categoryId] = s.myRanks[n.categoryId].map((x) => (x === n.id ? null : x));
      }
      break;
    }
    case 'edit': {
      if (d.kind === 'cat') { const c = s.categories.find((x) => x.id === d.id); if (c) Object.assign(c, { name: d.body.name, description: d.body.description }); }
      else {
        const n = s.nominees.find((x) => x.id === d.id); if (!n) return false;
        const p = d.body.personId && (s.people || []).find((x) => x.id === d.body.personId);
        if (p) Object.assign(n, { personId: p.id, name: p.name, photo: p.photo }); else if (d.body.name) n.name = d.body.name;
        n.reason = d.body.reason;
      }
      break;
    }
    case 'feedback': s.feedback = [...(s.feedback || []), { id: tid(), text: d.text, createdAt: new Date().toISOString(), mine: true }]; break;
    default: return false;
  }
  s.lockReady = simLockReady();
  render();
  if (d.msg) toast(d.msg);
  return true;
}

// ---------- Lukitus ("Lukko sisään") ----------
function lockBar() {
  const what = { 1: 'ehdotuksiasi', 2: 'ääniäsi', 3: 'ehdotuksiasi', 4: 'sijoituksiasi', 5: 'finaaliääniäsi' }[state.phase];
  return `
  <section class="section">
    <div class="panel lock-panel">
      <p class="eyebrow">Valmista?</p>
      <h2 class="h2">Lukitse vastauksesi</h2>
      <p class="muted" style="margin:0;max-width:52ch">Kun olet tyytyväinen valintoihisi, lukitse ne. Lukituksen jälkeen et voi enää muuttaa tämän vaiheen ${what}.</p>
      <button class="btn btn--primary" data-act="lock" ${state.lockReady.ok ? '' : 'disabled'}>Lukko sisään</button>
      ${state.lockReady.ok ? '' : `<p class="small lock-need" style="margin:0;max-width:52ch">${esc(state.lockReady.reason)}</p>`}
    </div>
  </section>`;
}

// Varoitus käyttämättä jääneistä ehdotuksista tai äänistä ennen lukitusta
function lockWarning() {
  const s = state; const L = s.limits;
  if (s.phase === 1) {
    return s.used.catProposals === 0 ? 'Et ole ehdottanut yhtään kategoriaa.\n\n' : '';
  }
  if (s.phase === 2) {
    const left = L.catVotes - s.used.catVotes;
    return left > 0 ? `Sinulla on vielä ${left} ääntä käyttämättä.\n\n` : '';
  }
  if (s.phase === 3) return s.nominees.some((n) => n.mine) ? '' : 'Et ole ehdottanut yhtään ehdokasta.\n\n';
  if (s.phase === 4) return '';
  if (s.phase === 5) {
    const left = s.categories.filter((c) => !s.nominees.some((n) => n.categoryId === c.id && n.myFinal)).length;
    return left > 0 ? `${left} kategoriaa on vielä äänestämättä.\n\n` : '';
  }
  return '';
}

// Odotusnäyttö: osallistuja on lukinnut vastauksensa, ja seuraava vaihe ei ole vielä alkanut.
// Sivu päivittää tilan 15 sekunnin välein, joten uusi vaihe tulee näkyviin itsestään.
function waitingView() {
  const s = state;
  let rows = [];
  if (s.phase === 1) {
    const mine = s.categories.filter((c) => c.mine).map((c) => c.name);
    rows = [['Ehdottamasi kategoriat', mine.length ? mine.join(', ') : 'Ei ehdotuksia']];
  } else if (s.phase === 2) {
    const mine = s.categories.filter((c) => c.myVote).map((c) => c.name);
    rows = [['Äänestämäsi kategoriat', mine.length ? mine.join(', ') : 'Ei ääniä']];
  } else if (s.phase === 3) {
    rows = s.categories.map((c) => {
      const mine = s.nominees.filter((n) => n.categoryId === c.id && n.mine).map((n) => `${n.name} – ${n.reason}`);
      return [c.name, mine.length ? mine.join(' · ') : 'Ei ehdotuksia'];
    });
  } else if (s.phase === 4) {
    const byId = Object.fromEntries(s.nominees.map((n) => [n.id, n]));
    rows = s.categories.map((c) => {
      const picks = myRanking(c.id).map((id, i) => (id && byId[id] ? `${i + 1}. ${byId[id].name}` : null)).filter(Boolean);
      return [c.name, picks.length ? picks.join(' · ') : 'Ei sijoituksia'];
    });
  } else {
    rows = s.categories.map((c) => {
      const picks = s.nominees.filter((n) => n.categoryId === c.id && n.myFinal).map((n) => n.name);
      return [c.name, picks.length ? picks.join(', ') : 'Ei ääntä'];
    });
  }
  const last = s.phase === LAST_OPEN;
  // Näytetään erikseen asetettu "seuraava vaihe alkaa" -aika ja/tai tämän vaiheen päättymisaika vaihepalkin asetuksista
  const end = s.phaseEnds && s.phaseEnds[s.phase];
  const when = [
    end ? `<p class="next-start">${last ? 'Äänestys päättyy' : 'Tämä vaihe päättyy'} <b>${esc(fmtEnd(end))}</b></p>` : '',
    s.nextStart ? `<p class="next-start">${last ? 'Tulokset julkistetaan' : 'Seuraava vaihe alkaa'} <b>${esc(s.nextStart)}</b></p>` : '',
  ].join('');
  return `
  <section class="section screen-center">
    <div class="panel lock-panel is-locked">
      <img class="lock-trophy" src="/logo.svg" alt="" width="108" height="236">
      <p class="eyebrow">Lukko sisään · vaihe ${s.phase} / ${LAST_OPEN}</p>
      <h1 class="h1">${last ? 'Äänesi on lukittu' : 'Seuraava vaihe ei ole vielä alkanut'}</h1>
      ${when}
      <p class="muted" style="margin:0;max-width:52ch">${last ? 'Kiitos äänistä! Voittajat julkistetaan Gaalassa.' : 'Olet jo vastannut tähän vaiheeseen. Odota, että järjestäjät avaavat seuraavan vaiheen – sivu päivittyy itsestään.'}</p>
      <dl class="lock-summary">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${s.me.unlockRequested
        ? `<div class="unlock-sent" role="status">
            <p>Tukipyyntönne on välitetty järjestelmänvalvojalle. Olkaa hyvä ja tarkistakaa tilanne myöhemmin uudelleen.</p>
            <p lang="en">Your support request has been forwarded to an administrator. Please check again later.</p>
          </div>`
        : `<div class="unlock-ask"><p class="small muted" style="margin:0">Haluatko muuttaa jotain?</p><button class="btn btn--secondary btn--sm" data-act="unlock-request">Pyydä lukon avausta</button></div>`}
    </div>
  </section>
  ${feedbackView(true)}`;
}

// Vaihe 1: kategorioiden ehdottaminen (ei äänestystä)
function phaseProposals() {
  const s = state; const L = s.limits;
  const left = L.maxCategoryProposals - s.used.catProposals;
  const cats = [...s.categories].sort((a, b) => (b.fixed - a.fixed) || (b.mine - a.mine) || a.name.localeCompare(b.name, 'fi'));
  return `
  <section class="section">
    <form class="panel" id="cat-form">
      <div class="cat-head" style="border:0;padding:0"><p class="eyebrow">Uusi kategoria</p><p class="small muted" style="margin:0">Ehdotuksia jäljellä ${Math.max(0, left)} / ${L.maxCategoryProposals}. Ehdottajan nimi näkyy vain järjestäjille.</p></div>
      <div class="form-row">
        <div class="field"><label for="c-name">Nimi</label><input class="input" id="c-name" data-keep maxlength="60" required placeholder="Esim. Vuoden myöhästyjä" ${left <= 0 ? 'disabled' : ''}></div>
        <div class="field"><label for="c-desc">Kuvaus (valinnainen)</label><input class="input" id="c-desc" data-keep maxlength="160" placeholder="Mistä palkinto annetaan?" ${left <= 0 ? 'disabled' : ''}></div>
        <button class="btn btn--primary" type="submit" ${left <= 0 ? 'disabled' : ''}>${left <= 0 ? 'Ehdotukset käytetty' : 'Ehdota'}</button>
      </div>
    </form>
    <header class="cat-head"><p class="eyebrow">Ehdotetut kategoriat · ${cats.length}</p></header>
    <div class="list">
      ${cats.map((c) => isEditing('cat', c.id, false) ? `
      <div class="item is-voted is-editing">${editForm('cat', c, false)}</div>` : `
      <div class="item ${c.mine ? 'is-voted' : ''}">
        <div>
          <div class="title">${esc(c.name)} ${c.fixed ? '<span class="tag tag--gold">Mukana aina</span>' : ''} ${c.mine ? '<span class="tag">Sinun ehdotuksesi</span>' : ''}</div>
          ${c.description ? `<p>${esc(c.description)}</p>` : ''}
        </div>
        ${c.mine ? `<div class="item-actions">${editButton('cat', c.id, false)}${deleteButton('cat', c.id)}</div>` : ''}
      </div>`).join('')}
      ${cats.length <= 1 ? '<div class="empty">Ei vielä muita ehdotuksia. Ehdota ensimmäinen kategoria yllä.</div>' : ''}
    </div>
  </section>`;
}

// Vaihe 2: äänestys Gaalaan pääsevistä kategorioista
function phaseCategoryVote() {
  const s = state; const L = s.limits;
  const cats = [...s.categories].sort((a, b) => (b.fixed - a.fixed) || a.name.localeCompare(b.name, 'fi'));
  const full = s.used.catVotes >= L.catVotes;
  return `
  <section class="section">
    <div class="list">
      ${cats.map((c) => `
      <div class="item ${c.myVote ? 'is-voted' : ''}">
        <div>
          <div class="title">${esc(c.name)} ${c.fixed ? '<span class="tag tag--gold">Mukana aina</span>' : ''} ${c.mine ? '<span class="tag">Sinun ehdotuksesi</span>' : ''}</div>
          ${c.description ? `<p>${esc(c.description)}</p>` : ''}
        </div>
        ${c.fixed ? '' : `<button class="btn btn--sm ${c.myVote ? 'btn--voted' : 'btn--secondary'}" data-act="vote-cat" data-id="${c.id}" aria-pressed="${c.myVote}" ${!c.myVote && full ? 'disabled title="Kaikki äänet käytetty"' : ''}>${c.myVote ? 'Äänestetty' : 'Äänestä'}</button>`}
      </div>`).join('')}
      ${cats.length <= 1 ? '<div class="empty">Kategorioita ei ehdotettu.</div>' : ''}
    </div>
  </section>`;
}

// ---------- Muokkaus ----------
const isEditing = (kind, id, admin) => !!(editing && editing.kind === kind && editing.id === id && !!editing.admin === !!admin);

function editButton(kind, id, admin, label = 'Muokkaa') {
  return `<button class="btn btn--ghost" type="button" data-act="edit" data-kind="${kind}" data-id="${id}" data-admin="${admin ? 1 : ''}">${label}</button>`;
}

function deleteButton(kind, id) {
  return `<button class="btn btn--ghost" type="button" data-act="del-own" data-kind="${kind}" data-id="${id}">Poista</button>`;
}

// Henkilövalinta ehdokkaan muokkaukseen. Vanhalle vapaalla nimellä tehdylle ehdokkaalle jätetään nimikenttä.
function personField(k, item) {
  const ppl = [...(state.people || [])];
  if (item.personId && !ppl.some((p) => p.id === item.personId)) ppl.unshift({ id: item.personId, name: item.name });
  if (!item.personId) return `<div class="field"><label for="e1-${k}">Ehdokas</label><input class="input" id="e1-${k}" data-keep maxlength="60" required value="${esc(item.name)}"></div>`;
  return `<div class="field"><label for="e1-${k}">Ehdokas</label><select class="input" id="e1-${k}" data-keep>${ppl.map((p) => `<option value="${p.id}" ${p.id === item.personId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`;
}

function editForm(kind, item, admin) {
  const cat = kind === 'cat';
  const k = `${kind}-${item.id}`;
  return `
  <form class="edit-form" data-form="edit" data-kind="${kind}" data-id="${item.id}" data-admin="${admin ? 1 : ''}" data-person="${item.personId ? 1 : ''}">
    ${cat ? `<div class="field"><label for="e1-${k}">Kategorian nimi</label><input class="input" id="e1-${k}" data-keep maxlength="60" required value="${esc(item.name)}"></div>` : personField(k, item)}
    <div class="field"><label for="e2-${k}">${cat ? 'Kuvaus (valinnainen)' : 'Mistä?'}</label><input class="input" id="e2-${k}" data-keep maxlength="160" ${cat ? '' : 'required'} value="${esc(cat ? item.description : item.reason)}"></div>
    <div class="edit-actions"><button class="btn btn--primary btn--sm" type="submit">Tallenna</button><button class="btn btn--ghost" type="button" data-act="edit-cancel">Peruuta</button></div>
  </form>`;
}

function initial(name) {
  const ch = [...String(name).trim()][0] || '?';
  return ch.toLocaleUpperCase('fi');
}

// Kuva, jos sellainen on; muuten kultainen nimikirjainmitali
function portrait(item, cls = 'nom-mono') {
  // Jos kuva ei lataudu, näytetään nimikirjain sen tilalla
  const fallback = `<span>${esc(initial(item.name))}</span>`;
  return `<div class="${cls}${item.photo ? ' has-photo' : ''}" aria-hidden="true">${item.photo ? `<img src="${item.photo.src}" alt="" loading="lazy" style="${cropStyle(item.photo)}" onerror="this.parentNode.classList.remove('has-photo');this.outerHTML=${esc(JSON.stringify(fallback))}">` : fallback}</div>`;
}

// Rajaus CSS:llä: kohdistuspiste object-positionilla ja zoom skaalauksella saman pisteen ympäri.
// Toimii kaikissa kortin muodoissa (pystykortti, pyöreä henkilökuva, hallinnan pikkukuva).
function cropStyle(c) {
  const x = Number(c.x ?? 50), y = Number(c.y ?? 50), z = Number(c.z ?? 1);
  return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;transform:scale(${z})`;
}

// Vaihe 3: ehdokkaat. Ehdotetaan valitsemalla henkilökortti ja kirjoittamalla peruste. Äänestys on vaihe 4.
function phaseNominees() {
  const s = state; const L = s.limits;
  return s.categories.map((c, idx) => {
    const noms = s.nominees.filter((n) => n.categoryId === c.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'fi') || a.reason.localeCompare(b.reason, 'fi'));
    const myProps = noms.filter((n) => n.mine).length;
    const propsLeft = L.maxNomineeProposals - myProps;
    const picked = proposing && proposing.catId === c.id ? (s.people || []).find((p) => p.id === proposing.personId) : null;
    return `
    <section class="section" id="cat-${c.id}">
      <header class="cat-head">
        <p class="eyebrow">Kategoria ${String(idx + 1).padStart(2, '0')}</p>
        <div class="row"><h2 class="h2">${esc(c.name)}</h2><span class="meter small">${pips(myProps, L.maxNomineeProposals)} Ehdotuksia ${myProps} / ${L.maxNomineeProposals}</span></div>
        ${c.description ? `<p class="muted" style="margin:0">${esc(c.description)}</p>` : ''}
      </header>
      ${noms.length ? `
      <div class="nom-grid">
        ${noms.map((n) => `
        <article class="nom-card">
          <div class="nom-media">${portrait(n)}${n.mine ? '<span class="tag nom-tag">Sinun ehdotuksesi</span>' : ''}</div>
          ${isEditing('nom', n.id, false) ? `<div class="nom-body">${editForm('nom', n, false)}</div>` : `<div class="nom-body">
            <h3 class="h3">${esc(n.name)}</h3>
            <p>${esc(n.reason)}</p>
            ${n.mine ? `<div class="item-actions">${editButton('nom', n.id, false)}${deleteButton('nom', n.id)}</div>` : ''}
          </div>`}
        </article>`).join('')}
      </div>` : '<div class="empty">Ei vielä ehdokkaita. Ehdota ensimmäinen alla.</div>'}
      <div class="panel propose-panel">
        <div class="cat-head" style="border:0;padding:0"><p class="eyebrow">Ehdota ehdokasta</p><p class="small muted" style="margin:0">${propsLeft > 0 ? `Valitse henkilö ja kirjoita mistä. Ehdotuksia jäljellä ${propsLeft} / ${L.maxNomineeProposals}.` : `Olet käyttänyt kaikki ${L.maxNomineeProposals} ehdotustasi tässä kategoriassa. Voit poistaa oman ehdotuksesi, jos haluat ehdottaa jotain muuta.`}</p></div>
        <div class="person-grid" role="list">
          ${(s.people || []).map((p) => `
          <button type="button" class="person-card ${picked && picked.id === p.id ? 'is-picked' : ''}" role="listitem" data-act="pick-person" data-cat="${c.id}" data-person="${p.id}" ${propsLeft > 0 ? '' : 'disabled'} aria-pressed="${!!(picked && picked.id === p.id)}">
            ${portrait(p, 'person-photo')}<span class="person-name">${esc(p.name)}</span>
          </button>`).join('')}
        </div>
        ${picked ? `
        <form class="propose-form" data-form="nom" data-cat="${c.id}" data-person="${picked.id}">
          <div class="field"><label for="pr-${c.id}">Mistä ehdotat: ${esc(picked.name)}?</label><input class="input" id="pr-${c.id}" data-keep maxlength="160" required minlength="3" placeholder="Mikä hetki tai teko?"></div>
          <div class="edit-actions"><button class="btn btn--primary btn--sm" type="submit">Ehdota</button><button class="btn btn--ghost" type="button" data-act="pick-cancel">Peruuta</button></div>
        </form>` : ''}
      </div>
    </section>`;
  }).join('');
}

// ---------- Vaihe 4: ehdokasäänestys (top 3 per kategoria) ----------
// Oma sijoitus kategoriassa: taulukko [1. sija, 2. sija, 3. sija] (tyhjä = null), pituus = jaettavat sijat
function rankSlotsFor(catId) {
  return Math.min((state.limits && state.limits.rankSlots) || 3, state.nominees.filter((n) => n.categoryId === catId).length);
}
function myRanking(catId) {
  const slots = rankSlotsFor(catId);
  const ids = new Set(state.nominees.filter((n) => n.categoryId === catId).map((n) => n.id));
  const arr = ((state.myRanks || {})[catId] || []).slice(0, slots).map((id) => (ids.has(id) ? id : null));
  while (arr.length < slots) arr.push(null);
  return arr;
}
function rankProgress() {
  return state.categories.map((c) => ({ cat: c, need: rankSlotsFor(c.id), have: myRanking(c.id).filter(Boolean).length }));
}
// Sama logiikka kuin palvelimella: ehdokas sijalle (0 = pois); varatun sijan haltija vaihtaa paikkaa
function applyRank(arr, id, place) {
  arr = arr.slice();
  const from = arr.indexOf(id);
  if (from >= 0) arr[from] = null;
  if (place > 0) {
    const prev = arr[place - 1];
    if (prev && from >= 0) arr[from] = prev;
    arr[place - 1] = id;
  }
  return arr;
}
function phaseRanking() {
  const s = state; const pts = s.limits.rankPoints || [3, 2, 1];
  return s.categories.map((c, idx) => {
    const noms = s.nominees.filter((n) => n.categoryId === c.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'fi') || a.reason.localeCompare(b.reason, 'fi'));
    const ranking = myRanking(c.id);
    const byId = Object.fromEntries(noms.map((n) => [n.id, n]));
    const have = ranking.filter(Boolean).length;
    return `
    <section class="section" id="cat-${c.id}">
      <header class="cat-head">
        <p class="eyebrow">Kategoria ${String(idx + 1).padStart(2, '0')}</p>
        <div class="row"><h2 class="h2">${esc(c.name)}</h2><span class="meter small">${pips(have, ranking.length)} Sijat ${have} / ${ranking.length}</span></div>
        ${c.description ? `<p class="muted" style="margin:0">${esc(c.description)}</p>` : ''}
      </header>
      ${noms.length ? `
      <ol class="rank-summary" aria-label="Sinun top ${ranking.length}: ${esc(c.name)}">
        ${ranking.map((id, i) => `<li class="${id ? 'is-set' : ''}"><span class="rank-medal r${i + 1}">${i + 1}.</span><span class="rank-name">${id && byId[id] ? esc(byId[id].name) : '<span class="muted">valitse alta</span>'}</span><span class="rank-pts">${pts[i]} p</span></li>`).join('')}
      </ol>
      <div class="nom-grid">
        ${noms.map((n) => {
          const place = ranking.indexOf(n.id) + 1;
          return `
        <article class="nom-card ${place ? `is-voted rank-${place}` : ''}">
          <div class="nom-media">${portrait(n)}${place ? `<span class="rank-badge r${place}" aria-hidden="true">${place}.</span>` : ''}${n.mine ? '<span class="tag nom-tag">Sinun ehdotuksesi</span>' : ''}</div>
          <div class="nom-body">
            <h3 class="h3">${esc(n.name)}</h3>
            <p>${esc(n.reason)}</p>
          </div>
          <div class="rank-btns" role="group" aria-label="Sija: ${esc(n.name)}">
            ${ranking.map((_, i) => `<button type="button" class="rank-btn r${i + 1} ${place === i + 1 ? 'is-on' : ''}" data-act="rank" data-id="${n.id}" data-place="${i + 1}" aria-pressed="${place === i + 1}" title="${place === i + 1 ? 'Poista sijalta' : PLACE_LABEL[i + 1] + ' (' + pts[i] + ' p)'}">${i + 1}.</button>`).join('')}
          </div>
        </article>`;
        }).join('')}
      </div>` : '<div class="empty">Tähän kategoriaan ei tullut ehdokkaita.</div>'}
    </section>`;
  }).join('');
}

// Vaihe 5: finaali pystykortteina. Koko kortti on valintanappi (radio), joten valinta toimii myös näppäimistöllä.
function phaseFinal() {
  const s = state;
  return s.categories.map((c, idx) => {
    const noms = s.nominees.filter((n) => n.categoryId === c.id);
    return `
    <section class="section">
      <header class="cat-head">
        <p class="eyebrow">Kategoria ${String(idx + 1).padStart(2, '0')}</p>
        <h2 class="h2">${esc(c.name)}</h2>
        ${c.description ? `<p class="muted" style="margin:0">${esc(c.description)}</p>` : ''}
      </header>
      <div class="final-grid" role="radiogroup" aria-label="${esc(c.name)}">
        ${noms.map((n) => `
        <label class="final-card ${n.myFinal ? 'is-voted' : ''}">
          <input type="radio" name="f-${c.id}" value="${n.id}" data-act="final" ${n.myFinal ? 'checked' : ''}>
          ${portrait(n, 'final-photo')}
          <span class="final-body"><b>${esc(n.name)}</b>${n.reason ? `<span>${esc(n.reason)}</span>` : ''}</span>
          <span class="final-pick">${n.myFinal ? '✓ Sinun valintasi' : 'Valitse'}</span>
        </label>`).join('')}
      </div>
    </section>`;
  }).join('');
}


// ---------- Admin ----------
function adminView() {
  const s = state; const a = s.admin; const L = s.limits;
  const maxCat = Math.max(1, ...a.categories.map((c) => c.votes));
  const advanced = a.categories.filter((c) => c.advanced);
  const phaseNames = { 1: 'Kategoriaehdotukset', 2: 'Kategoria-äänestys', 3: 'Ehdokasehdotukset', 4: 'Ehdokasäänestys', 5: 'Finaali', 6: 'Suljettu' };
  return `
  <section class="admin" aria-labelledby="admin-h">
    <header class="cat-head"><p class="eyebrow">Vain järjestäjille</p><h2 class="h2" id="admin-h">Hallinta</h2></header>

    <div class="admin-grid">
      <div class="panel">
        <p class="eyebrow">Vaihe</p>
        <p style="margin:0">Nyt: <b>${s.phase}. ${phaseNames[s.phase]}</b></p>
        <div class="phase-btns">${[1, 2, 3, 4, 5, 6].filter((p) => p !== s.phase).map((p) => `<button class="btn btn--sm ${p === s.phase + 1 ? 'btn--primary' : 'btn--secondary'}" data-act="phase" data-phase="${p}">${p > s.phase ? 'Siirry' : 'Palaa'}: ${phaseNames[p]}</button>`).join('')}</div>
      </div>
      <div class="panel">
        <p class="eyebrow">Osallistujat</p>
        <p style="margin:0" class="h3">${a.participants.length} koodia · ${a.participants.filter((p) => p.joined).length} kirjautunut</p>
        <p class="small muted" style="margin:0">Osallistuneita: kategoriaehdotukset – ${a.voters.p1}, kategoria-äänestys – ${a.voters.p2}, ehdokasehdotukset – ${a.voters.p3}, ehdokasäänestys – ${a.voters.p4}, finaali – ${a.voters.p5}</p>
        ${s.phase <= LAST_OPEN ? `<p class="small" style="margin:0">Lukinneet tässä vaiheessa: <b style="color:var(--gold-light);font-weight:500">${a.locked} / ${a.participants.filter((p) => !p.tester).length}</b></p>` : ''}
        ${s.phase <= LAST_OPEN && a.participants.some((p) => p.unlockRequested) ? `<p class="small unlock-req-line" style="margin:0">Lukon avausta pyytää: <b>${a.participants.filter((p) => p.unlockRequested).map((p) => esc(p.name)).join(', ')}</b> <span class="muted">(Osallistujat → Avaa lukko)</span></p>` : ''}
      </div>
      ${k18Panel()}
    </div>

    ${participantsView()}

    <form class="panel" id="settings-form">
      <p class="eyebrow">Asetukset</p>
      <div class="admin-grid">
        ${[['Kategoriaehdotukset', 1], ['Kategoria-äänestys', 2], ['Ehdokasehdotukset', 3], ['Ehdokasäänestys', 4], ['Finaali', 5]].map(([n, p]) => `<div class="field"><label for="s-end${p}">Vaihe ${p} (${n}) päättyy</label><input class="input" id="s-end${p}" type="datetime-local" value="${esc((s.phaseEnds || {})[p] || '')}"></div>`).join('')}
        <div class="field"><label for="s-next">Seuraava vaihe alkaa (näkyy odotusnäytöllä)</label><input class="input" id="s-next" value="${esc(s.nextStart)}" placeholder="la 5.12. klo 18"><span class="small muted">Tyhjenee, kun vaihe vaihtuu</span></div>
        <div class="field"><label for="s-tc">Kategorioita Gaalassa (sis. kiinteän)</label><input class="input" id="s-tc" type="number" min="2" max="50" value="${L.targetCategories}"><span class="small muted">→ äänestyksellä valitaan ${L.advanceCount}</span></div>
        <div class="field"><label for="s-cv">Ääniä / hlö kategoria-äänestyksessä</label><input class="input" id="s-cv" type="number" min="1" max="50" value="${L.catVotes}"></div>
        <div class="field"><label for="s-mc">Kategoriaehdotuksia / hlö</label><input class="input" id="s-mc" type="number" min="1" max="50" value="${L.maxCategoryProposals}"></div>
        <div class="field"><label for="s-mn">Ehdokasehdotuksia / hlö / kategoria</label><input class="input" id="s-mn" type="number" min="1" max="50" value="${L.maxNomineeProposals}"></div>
        <div class="field"><label for="s-fi">Finalisteja / kategoria (automaattivalinta)</label><input class="input" id="s-fi" type="number" min="1" max="50" value="${L.finalists}"></div>
      </div>
      <div><button class="btn btn--secondary btn--sm" type="submit">Tallenna asetukset</button></div>
    </form>

    ${notifyPanel()}

    ${bulletinPanel()}

    ${awardsPanel()}

    <div style="display:grid;gap:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <p class="eyebrow">Kategoriat · jatkoon ${advanced.length} / ${L.targetCategories}</p>
        <button class="btn btn--secondary btn--sm" data-act="auto-advance">Valitse ${L.advanceCount} eniten ääniä saanutta</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Jatkoon</th><th>Kategoria</th><th>Äänet</th><th></th><th></th></tr></thead>
        <tbody>${[...a.categories].sort((x, y) => (y.fixed - x.fixed) || (y.votes - x.votes)).map((c) => `
          <tr>
            <td><label class="check"><input type="checkbox" data-act="advance" data-id="${c.id}" ${c.advanced ? 'checked' : ''} ${c.fixed ? 'disabled' : ''}><span class="small muted">${c.fixed ? 'aina' : ''}</span></label></td>
            <td>${isEditing('cat', c.id, true) ? editForm('cat', c, true) : `<b style="font-weight:500">${esc(c.name)}</b>${c.description ? `<div class="small muted">${esc(c.description)}</div>` : ''}<div class="by">${c.fixed ? 'Kiinteä' : `Ehdottaja: ${esc(c.byName || 'poistettu osallistuja')}`}</div>`}</td>
            <td style="width:30%">${c.fixed ? '<span class="small muted">kiinteä</span>' : `<div class="bar"><i style="width:${(c.votes / maxCat) * 100}%"></i></div>`}</td>
            <td class="num">${c.fixed ? '' : c.votes}</td>
            <td class="act">${isEditing('cat', c.id, true) ? '' : editButton('cat', c.id, true)}${c.fixed || isEditing('cat', c.id, true) ? '' : `<button class="btn btn--ghost" data-act="del-cat" data-id="${c.id}" aria-label="Poista ${esc(c.name)}">Poista</button>`}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>

    ${s.phase >= 3 ? `
    <div style="display:grid;gap:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <p class="eyebrow">Ehdokkaat · valitse finalistit</p>
        <button class="btn btn--secondary btn--sm" data-act="auto-finalists">Valitse ${L.finalists} eniten pisteitä saanutta jokaiseen</button>
        ${s.phase >= 5 ? `<label class="check small"><input type="checkbox" data-act="toggle-final-counts" ${showFinalCounts ? 'checked' : ''}> Näytä finaalin äänet (spoileri)</label>` : ''}
      </div>
      ${advanced.map((c) => {
        // Järjestys pisteiden mukaan; tasapisteissä enemmän 1. sijoja, sitten 2. sijoja (sama kuin automaattivalinnassa)
        const noms = a.nominees.filter((n) => n.categoryId === c.id).sort((x, y) => y.points - x.points || y.places[0] - x.places[0] || y.places[1] - x.places[1] || y.places[2] - x.places[2]);
        const max = Math.max(1, ...noms.map((n) => n.points));
        const fin = noms.filter((n) => n.finalist).length;
        return `<div class="table-wrap"><table>
          <thead><tr><th colspan="${s.phase >= 5 && showFinalCounts ? 6 : 5}">${esc(c.name)} · ${fin} finalistia</th></tr></thead>
          <tbody>${noms.map((n) => `
            <tr data-drop-target="nom" data-drop-id="${n.id}">
              <td style="width:1%"><input type="checkbox" class="check" style="width:18px;height:18px;accent-color:var(--gold)" data-act="finalist" data-id="${n.id}" ${n.finalist ? 'checked' : ''} aria-label="Finalisti: ${esc(n.name)}"></td>
              <td>${isEditing('nom', n.id, true) ? editForm('nom', n, true) : `<div class="adm-entry">${portrait(n, 'thumb')}<div><b style="font-weight:500">${esc(n.name)}</b>${n.reason ? `<div class="small muted">${esc(n.reason)}</div>` : ''}<div class="by">Ehdottaja: ${esc(n.byName || 'poistettu osallistuja')}</div>
                <div class="photo-actions">${photoButton('nom', n.id, n.ownPhoto ? 'Vaihda kortin kuva' : 'Kortin oma kuva')}${n.photo ? `<button class="btn btn--ghost" data-act="crop-open" data-target="nom" data-id="${n.id}">Rajaa ja esikatsele</button>` : ''}${n.ownPhoto ? `<button class="btn btn--ghost" data-act="photo-del" data-target="nom" data-id="${n.id}">Poista kortin kuva</button>` : ''}</div></div></div>`}</td>
              <td style="width:25%"><div class="bar"><i style="width:${(n.points / max) * 100}%"></i></div>${n.points ? `<div class="small muted rank-split">1.×${n.places[0]} · 2.×${n.places[1]} · 3.×${n.places[2]}</div>` : ''}${n.rankVoters.length ? `<div class="voters">${[1, 2, 3].map((pl) => { const v = n.rankVoters.filter((x) => x.place === pl).map((x) => x.name); return v.length ? `${pl}.: ${esc(v.join(', '))}` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}</td>
              <td class="num">${n.points} p</td>
              ${s.phase >= 5 && showFinalCounts ? `<td class="num" style="color:var(--gold-text)">${n.finalist ? n.finalVotes + ' fin.' : ''}${n.finalVoters.length ? `<div class="voters">${esc(n.finalVoters.join(', '))}</div>` : ''}</td>` : ''}
              <td class="act">${isEditing('nom', n.id, true) ? '' : `${editButton('nom', n.id, true)}<button class="btn btn--ghost" data-act="del-nom" data-id="${n.id}" aria-label="Poista ${esc(n.name)}">Poista</button>`}</td>
            </tr>`).join('') || `<tr><td colspan="6" class="muted">Ei ehdokkaita.</td></tr>`}</tbody>
        </table></div>`;
      }).join('')}
    </div>` : ''}

    ${s.phase === 6 ? resultsView() : ''}
    ${s.phase === 6 || (a.feedbackLog || []).length ? feedbackLogView() : ''}

    <div class="panel danger-panel">
      <p class="eyebrow">Vaaravyöhyke</p>
      <h3 class="h3">Nollaa Gaala</h3>
      <p class="small muted" style="margin:0">Poistaa kaikki kategoriaehdotukset, ehdokkaat, äänet, lukitukset ja palautteet ja palauttaa vaiheen 1. Osallistujat, koodit, kuvat ja asetukset säilyvät, ellei alla toisin valita. Palvelin tallentaa nykyisen tilanteen varmuuskopioksi ennen nollausta.</p>
      <label class="check small"><input type="checkbox" id="reset-users"> Poista myös osallistujat (koodit lakkaavat toimimasta)</label>
      <div><button class="btn btn--danger btn--sm" type="button" data-act="reset-gala">Nollaa Gaala</button></div>
    </div>
  </section>`;
}

function participantsView() {
  const a = state.admin; const ph = state.phase;
  const versions = (id) => (state.photoSuggestions || []).filter((x) => x.personId === id).length;
  const L = state.limits;
  // Käytetyt ehdotukset tai äänet tässä vaiheessa
  const status = (p) => {
    if (ph === 1) return `${p.p1} / ${L.maxCategoryProposals} ehdotusta`;
    if (ph === 2) return `${p.p2} / ${L.catVotes} ääntä`;
    if (ph === 3) return `${p.p3} ehdotusta`;
    if (ph === 4) return `${p.p4} / ${a.rankCats} kategoriaa`;
    return `${p.p5} / ${state.categories.length} ääntä`;
  };
  return `
  <div style="display:grid;gap:12px">
    <p class="eyebrow">Osallistujat ja koodit</p>
    <form class="panel" id="users-form">
      <div class="field"><label for="u-names">Lisää kavereita (yksi nimi per rivi tai pilkulla erotettuna)</label>
        <textarea class="input" id="u-names" data-keep rows="2" placeholder="Aino, Eetu, Juho"></textarea></div>
      <div><button class="btn btn--secondary btn--sm" type="submit">Luo koodit</button></div>
    </form>
    ${a.participants.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Nimi</th><th>Koodi</th><th>${ph >= 5 ? 'Finaali' : 'Vaihe ' + ph} · käytetty</th><th>Ehdokkaana</th><th>Testi</th><th>Admin</th><th></th></tr></thead>
      <tbody>${a.participants.map((p) => `
        <tr data-drop-target="user" data-drop-id="${p.id}">
          <td><div class="adm-entry">${portrait({ ...p, photo: p.shownPhoto }, 'thumb')}<div><b style="font-weight:500">${esc(p.name)}</b>${p.tester ? ' <span class="tag tag--red">Testi</span>' : ''}${p.joined ? '' : '<div class="small muted">Ei vielä kirjautunut</div>'}
            <div class="photo-actions">${photoButton('user', p.id, p.photo ? 'Vaihda kuva' : 'Lisää kuva')}${p.photo ? `<button class="btn btn--ghost" data-act="crop-open" data-target="user" data-id="${p.id}">Rajaa</button><button class="btn btn--ghost" data-act="photo-del" data-target="user" data-id="${p.id}">Poista kuva</button>` : ''}${p.safePhoto ? `<button class="btn btn--ghost" data-act="crop-open" data-target="safe" data-id="${p.id}">Rajaa &lt;18</button><button class="btn btn--ghost" data-act="safe-del" data-id="${p.id}">Poista &lt;18</button>` : ''}${versions(p.id) ? `<button class="btn btn--ghost" data-act="photos-open" data-person="${p.id}">Kuvaversiot (${versions(p.id)})</button>` : ''}</div></div></div></td>
          <td><code class="code">${esc(p.code)}</code></td>
          <td class="small">${ph <= LAST_OPEN ? status(p) : '–'}${p.locked && ph <= LAST_OPEN ? ' <span class="tag tag--gold">Lukittu</span>' : ''}</td>
          <td class="nominable"><input type="checkbox" data-act="user-nominable" data-id="${p.id}" ${p.nominable ? 'checked' : ''} aria-label="Ehdokkaana: ${esc(p.name)}" title="Näkyykö henkilö ehdokaskorteissa"></td>
          <td class="tester"><input type="checkbox" data-act="user-tester" data-id="${p.id}" ${p.tester ? 'checked' : ''} aria-label="Testikäyttäjä: ${esc(p.name)}" title="Testikäyttäjä voi selata kaikkia vaiheita; mitään ei tallenneta"></td>
          <td><input type="checkbox" style="width:18px;height:18px;accent-color:var(--gold)" data-act="user-admin" data-id="${p.id}" ${p.admin ? 'checked' : ''} aria-label="Admin: ${esc(p.name)}"></td>
          <td class="act"><div class="act-grid">
            <button class="btn btn--ghost" data-act="user-stats" data-id="${p.id}">Tilastot</button>
            <button class="btn btn--ghost" data-act="copy-link" data-code="${esc(p.code)}" data-name="${esc(p.name)}">Kopioi linkki</button>
            <button class="btn btn--ghost" data-act="user-regen" data-id="${p.id}">Uusi koodi</button>
            <button class="btn btn--ghost" data-act="user-del" data-id="${p.id}">Poista</button>
            ${p.locked && ph <= LAST_OPEN ? `<button class="btn btn--ghost act-unlock" data-act="user-unlock" data-id="${p.id}" data-name="${esc(p.name)}">Avaa lukko${p.unlockRequested ? ' <span class="unlock-req-tag">pyytää</span>' : ''}</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted" style="margin:0">Linkki kirjaa kaverin sisään suoraan. "Uusi koodi" mitätöi vanhan koodin ja kirjaa kaverin ulos kaikilta laitteilta. Osallistujan kuva näkyy hänen henkilö- ja ehdokaskorteissaan; yksittäiselle ehdokaskortille voi vaihtaa oman kuvan ehdokastaulukosta. Tietokoneella kuvan voi myös raahata suoraan riville.</p>` : '<div class="empty">Ei vielä osallistujia. Lisää kaverien nimet yllä, niin jokainen saa oman koodin.</div>'}
  </div>`;
}

// ---------- Palaute (suljettu vaihe ja odotustilat) ----------
// Palaute näkyy muille ilman nimeä; järjestäjät näkevät kirjoittajan hallinnan palautelokista vaiheittain.
// waiting = odotustila lukituksen jälkeen: listassa näkyvät saman vaiheen odotustilan palautteet.
function feedbackView(waiting = false) {
  const list = [...(state.feedback || [])].reverse();
  return `
  <section class="section feedback">
    <form class="panel feedback-form" id="feedback-form">
      <p class="eyebrow">Anonyymi palaute</p>
      <h2 class="h2">${waiting ? 'Mitä mieltä olet tähän asti?' : 'Mitä mieltä olit?'}</h2>
      <p class="small muted" style="margin:0">Palaute näkyy muille nimettömänä.</p>
      <div class="field"><label for="fb-text" class="sr-only">Palaute</label><textarea class="input" id="fb-text" data-keep rows="4" maxlength="1000" placeholder="${waiting ? 'Kerro tästä vaiheesta, ehdotuksista tai mistä vain…' : 'Kerro Gaalasta, äänestyksestä tai mistä vain…'}"></textarea></div>
      <div><button class="btn btn--primary btn--sm" type="submit">Lähetä palaute</button></div>
    </form>
    <div class="feedback-list">
      ${list.length ? list.map((f) => `
      <article class="feedback-item">
        <p>${esc(f.text).replace(/\n/g, '<br>')}</p>
        <footer><span>— ${f.mine ? 'sinä (näkyy muille nimettömänä)' : 'nimetön'} · ${fmtTime(f.createdAt)}</span></footer>
      </article>`).join('') : '<div class="empty">Ei vielä palautetta. Ole ensimmäinen.</div>'}
    </div>
  </section>`;
}

const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('fi-FI', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// Hallinnan palauteloki: kirjoittaja näkyy vain täällä. Eritelty vaiheittain: vaiheiden 1–5 odotustilat ja suljettu vaihe.
const FEEDBACK_GROUPS = { 1: 'Odotustila · vaihe 1 Kategoriaehdotukset', 2: 'Odotustila · vaihe 2 Kategoria-äänestys', 3: 'Odotustila · vaihe 3 Ehdokasehdotukset', 4: 'Odotustila · vaihe 4 Ehdokasäänestys', 5: 'Odotustila · vaihe 5 Finaali', 6: 'Suljettu · Gaalan jälkeen' };
function feedbackLogView() {
  const log = state.admin.feedbackLog || [];
  const groups = [1, 2, 3, 4, 5, 6].map((ph) => [ph, log.filter((f) => (f.phase || 6) === ph).reverse()]).filter(([, l]) => l.length);
  return `
  <div style="display:grid;gap:12px">
    <p class="eyebrow">Palauteloki · ${log.length}</p>
    ${groups.length ? groups.map(([ph, l]) => `
    <div class="fb-group">
      <h3 class="h3 fb-group-h">${FEEDBACK_GROUPS[ph]} <span class="small muted">${l.length}</span></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Aika</th><th>Kirjoittaja</th><th>Palaute</th><th></th></tr></thead>
        <tbody>${l.map((f) => `
          <tr>
            <td class="small" style="white-space:nowrap">${fmtTime(f.createdAt)}</td>
            <td><b style="font-weight:500">${esc(f.name)}</b></td>
            <td class="fb-text">${esc(f.text).replace(/\n/g, '<br>')}</td>
            <td class="act"><button class="btn btn--ghost" data-act="fb-del" data-id="${f.id}">Poista</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('') : '<div class="empty">Ei vielä palautetta. Palautetta voi antaa jokaisen vaiheen odotustilassa ja Gaalan jälkeen.</div>'}
  </div>`;
}

// ---------- Osallistujan tilastot (admin) ----------
// Päivä ja kellonaika, esim. "ti 10.11. klo 23.25"
function fmtWhen(iso) {
  if (!iso) return 'aika ei tiedossa';
  try { return new Date(iso).toLocaleString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

function statsView() {
  const st = stats;
  // Jokainen osio: otsikko ja rivit [aika, pääteksti, lisätieto]; rivit aikajärjestyksessä
  const byTime = (a, b) => String(a.at || '').localeCompare(String(b.at || ''));
  const sections = [
    ['Vaihe 1 · Kategoriaehdotukset', [...st.categories].sort(byTime).map((c) => [c.at, c.name, [c.description, c.editedAt ? `muokattu ${fmtWhen(c.editedAt)}` : '', c.advanced ? 'pääsi Gaalaan' : ''].filter(Boolean).join(' · ')])],
    ['Vaihe 2 · Kategoria-äänet', [...st.catVotes].sort(byTime).map((v) => [v.at, v.name, ''])],
    ['Vaihe 3 · Ehdokasehdotukset', [...st.nominees].sort(byTime).map((n) => [n.at, `${n.name} – ${n.reason}`, [n.category, n.editedAt ? `muokattu ${fmtWhen(n.editedAt)}` : '', n.finalist ? 'finalisti' : ''].filter(Boolean).join(' · ')])],
    ['Vaihe 4 · Ehdokasäänestys (top 3)', [...st.ranks].sort((a, b) => byTime(a, b) || a.place - b.place).map((v) => [v.at, `${v.place}. sija: ${v.name} – ${v.reason}`, v.category])],
    ['Vaihe 5 · Finaaliäänet', [...st.finals].sort(byTime).map((v) => [v.at, `${v.name} – ${v.reason}`, v.category])],
    ['Lukitukset', [...st.locks].sort(byTime).map((l) => [l.at, `Lukko sisään: vaihe ${l.phase}`, l.phaseName])],
    ['Palaute', [...st.feedback].sort(byTime).map((f) => [f.at, f.text, (FEEDBACK_GROUPS[f.phase || 6] || '').split(' · ')[0] + ((f.phase || 6) < 6 ? ` (vaihe ${f.phase})` : '')])],
  ];
  const count = (k) => st[k].length;
  return `
  <div class="crop-overlay" role="dialog" aria-modal="true" aria-labelledby="stats-h">
    <div class="panel stats-dialog">
      <div class="stats-head">
        <div><p class="eyebrow">Tilastot</p><h2 class="h2" id="stats-h">${esc(st.name)}</h2></div>
        <button class="btn btn--ghost" type="button" data-act="stats-close">Sulje</button>
      </div>
      <p class="small muted" style="margin:0">Viimeksi kirjautunut: ${st.lastLogin ? fmtWhen(st.lastLogin) : 'ei vielä kirjautunut'} · Lisätty: ${fmtWhen(st.createdAt)}</p>
      <div class="stats-chips">
        <span><b>${count('categories')}</b> kategoriaehdotusta</span><span><b>${count('catVotes')}</b> kategoria-ääntä</span>
        <span><b>${count('nominees')}</b> ehdokasehdotusta</span><span><b>${count('ranks')}</b> ehdokassijoitusta</span>
        <span><b>${count('finals')}</b> finaaliääntä</span><span><b>${count('locks')}</b> lukitusta</span>
      </div>
      ${sections.map(([title, rows]) => `
      <section class="stats-sec">
        <h3>${title} <span class="muted">· ${rows.length}</span></h3>
        ${rows.length ? `<ol>${rows.map(([at, main, extra]) => `<li><time>${fmtWhen(at)}</time><span><b>${esc(main)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</span></li>`).join('')}</ol>` : '<p class="small muted">Ei mitään.</p>'}
      </section>`).join('')}
    </div>
  </div>`;
}

// ---------- Rajausikkuna (admin) ----------
// Vedä kuvaa siirtääksesi kohdistuspistettä, liukusäädin zoomaa. Esikatselu näyttää ehdokaskortin ja henkilökortin.
function openCrop(target, id) {
  if (target === 'hofcover') { // Hall of Famen kansikuva: rajaus luonnokseen
    const cv = hofDraft && hofDraft.cover;
    if (!cv || !cv.src) return;
    const c = cv.crop || {};
    cropping = { target, id, src: cv.src, x: c.x ?? 50, y: c.y ?? 50, z: c.z ?? 1, name: `Gaala ${hofDraft.year}`, reason: '' };
    render();
    return;
  }
  if (target === 'hof') { // Hall of Fame -lomakkeen rivi: rajaus menee luonnokseen ja tallentuu Gaalan mukana
    const n = hofRow(id);
    if (!n || !n.src) return;
    const person = hofPeople().find((p) => p.id === n.personId);
    const c = n.crop || {};
    cropping = { target, id, src: n.src, x: c.x ?? 50, y: c.y ?? 50, z: c.z ?? 1, name: (person ? person.name : n.name) || 'Ehdokas', reason: n.reason || '' };
    render();
    return;
  }
  const a = state.admin;
  const item = target === 'user' || target === 'safe' ? a.participants.find((p) => p.id === id) : a.nominees.find((n) => n.id === id);
  const ph = item && (target === 'safe' ? item.safePhoto : item.photo);
  if (!ph) return;
  cropping = { target, id, src: ph.src, x: ph.x, y: ph.y, z: ph.z, name: item.name, reason: item.reason || '' };
  render();
}

// Missä kukin esikatselu näkyy sivulla (rajausikkunan selitteet). Ehdokaskortin omaa kuvaa ei käytetä
// henkilökorteissa, joten sille ei näytetä henkilökortin esikatselua.
const CROP_WHERE = {
  user: { main: 'Ehdokaskortti · vaihe 3', final: 'Finaalikortti · vaihe 4', person: 'Henkilökortti · ehdokkaan valinta' },
  safe: { main: 'Ehdokaskortti · Alle K18', final: 'Finaalikortti · Alle K18', person: 'Henkilökortti · Alle K18' },
  nom: { main: 'Tämä ehdokaskortti · vaihe 3', final: 'Tämä finaalikortti · vaihe 4', person: '' },
  hof: { main: 'Rajausalue', final: 'Hall of Fame · voittaja', person: 'Hall of Fame · muut ehdokkaat' },
};

function cropView() {
  const c = cropping; const ph = { src: c.src, x: c.x, y: c.y, z: c.z };
  const where = CROP_WHERE[c.target] || CROP_WHERE.user;
  return `
  <div class="crop-overlay" role="dialog" aria-modal="true" aria-labelledby="crop-h">
    <div class="crop-dialog panel">
      <p class="eyebrow" id="crop-h">Rajaa ${c.target === 'safe' ? '&lt;18-kuva' : 'kuva'} · ${esc(c.name)}</p>
      <p class="small muted" style="margin:0">Vedä kuvaa siirtääksesi, zoomaa liukusäätimellä. Esikatselut näyttävät kuvan jokaisessa paikassa, jossa sitä käytetään.</p>
      ${c.target === 'hofcover' ? `<div class="crop-previews">
        <figure class="crop-fig crop-fig--wide">
          <figcaption class="crop-cap"><b>Hall of Fame · kansikuva otsikon alla</b>Vedä kuvaa tässä</figcaption>
          <div class="hof-cover crop-frame" data-crop-frame><img src="${c.src}" alt="" style="${cropStyle(ph)}"></div>
        </figure>
      </div>` : `<div class="crop-previews">
        <figure class="crop-fig">
          <figcaption class="crop-cap"><b>${where.main}</b>Vedä kuvaa tässä</figcaption>
          <article class="nom-card crop-card">
            <div class="nom-media crop-frame" data-crop-frame>${portrait({ name: c.name, photo: ph })}</div>
            <div class="nom-body"><h3 class="h3">${esc(c.name)}</h3><p>${esc(c.reason || (c.target === 'user' ? 'Ehdokaskortti' : ''))}</p></div>
            <span class="btn btn--sm btn--secondary" aria-hidden="true">${c.target === 'hof' ? '★ Voittaja' : 'Äänestä'}</span>
          </article>
        </figure>
        <div class="crop-side">
          <figure class="crop-fig">
            <figcaption class="crop-cap"><b>${where.final}</b></figcaption>
            <div class="final-card crop-final" aria-hidden="true">${portrait({ name: c.name, photo: ph }, 'final-photo')}<span class="final-body"><b>${esc(c.name)}</b></span></div>
          </figure>
          ${where.person ? `<figure class="crop-fig">
            <figcaption class="crop-cap"><b>${where.person}</b></figcaption>
            <div class="person-card crop-person" aria-hidden="true">${portrait({ name: c.name, photo: ph }, 'person-photo')}<span class="person-name">${esc(c.name)}</span></div>
          </figure>` : ''}
        </div>
      </div>`}
      <label class="crop-zoom"><span class="small muted">Zoom</span><input type="range" min="1" max="3" step="0.01" value="${c.z}" data-crop-zoom aria-label="Zoom"></label>
      <div class="edit-actions"><button class="btn btn--primary btn--sm" type="button" data-act="crop-save">Tallenna rajaus</button><button class="btn btn--ghost" type="button" data-act="crop-reset">Keskitä</button><button class="btn btn--ghost" type="button" data-act="crop-cancel">Peruuta</button></div>
    </div>
  </div>`;
}

// Päivitä kaikki esikatselukuvat ilman koko sivun uudelleenpiirtoa (sujuva vetäminen)
function applyCropPreview() {
  document.querySelectorAll('.crop-overlay img').forEach((img) => { img.style.cssText = cropStyle(cropping); });
  const z = document.querySelector('[data-crop-zoom]'); if (z && Number(z.value) !== cropping.z) z.value = cropping.z;
}

let cropDrag = null;
document.addEventListener('pointerdown', (e) => {
  const frame = e.target.closest('[data-crop-frame]');
  if (!frame || !cropping) return;
  e.preventDefault();
  frame.setPointerCapture(e.pointerId);
  const r = frame.getBoundingClientRect();
  cropDrag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: cropping.x, y: cropping.y, w: r.width, h: r.height };
});
document.addEventListener('pointermove', (e) => {
  if (!cropDrag || e.pointerId !== cropDrag.id) return;
  // Kuvan vetäminen oikealle tuo esiin vasenta reunaa, joten kohdistuspiste liikkuu vastakkaiseen suuntaan
  const k = 100 / cropping.z;
  cropping.x = Math.min(100, Math.max(0, cropDrag.x - ((e.clientX - cropDrag.sx) / cropDrag.w) * k));
  cropping.y = Math.min(100, Math.max(0, cropDrag.y - ((e.clientY - cropDrag.sy) / cropDrag.h) * k));
  applyCropPreview();
});
document.addEventListener('pointerup', () => { cropDrag = null; });
document.addEventListener('input', (e) => {
  if (e.target.dataset.hof && hofDraft) hofInput(e.target, false);
  if (e.target.matches('[data-crop-zoom]') && cropping) { cropping.z = Number(e.target.value); applyCropPreview(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (cropping) { cropping = null; render(); } else if (previewVersion) { previewVersion = null; render(); } else if (stats) { stats = null; render(); } else if (meCard) { meCard = false; render(); }
});
// Käyttäjäkortin tumma tausta sulkee kortin
document.addEventListener('click', (e) => {
  if (meCard && e.target.classList && e.target.classList.contains('me-overlay')) { meCard = false; render(); }
  if (previewVersion && e.target.classList && e.target.classList.contains('preview-overlay')) { previewVersion = null; render(); }
});

// Kuvan valinta: nappi avaa sivun ainoan, pysyvän tiedostokentän (ks. photoInput)
function photoButton(target, id, label) {
  return `<button class="btn btn--ghost" type="button" data-act="photo-pick" data-target="${target}" data-id="${id}">${label}</button>`;
}

function results() {
  const a = state.admin;
  return a.categories.filter((c) => c.advanced).map((c) => ({
    cat: c,
    noms: a.nominees.filter((n) => n.categoryId === c.id && n.finalist).sort((x, y) => y.finalVotes - x.finalVotes),
    winners: a.winners[c.id] || [],
  }));
}

function resultsView() {
  return `
  <div style="display:grid;gap:12px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <p class="eyebrow">Tulokset · Gaalan esitystä varten</p>
      <button class="btn btn--secondary btn--sm" data-act="copy-results">Kopioi tulokset tekstinä</button>
    </div>
    ${results().map(({ cat, noms, winners }) => `
    <div class="table-wrap"><table>
      <thead><tr><th colspan="3">${esc(cat.name)}</th></tr></thead>
      <tbody>${noms.map((n) => `
        <tr>
          <td><b style="font-weight:500">${esc(n.name)}</b> ${winners.includes(n.id) ? '<span class="tag tag--red">Voittaja</span>' : ''}${n.reason ? `<div class="small muted">${esc(n.reason)}</div>` : ''}<div class="voters">${n.finalVoters.length ? `Äänestäjät: ${esc(n.finalVoters.join(', '))}` : 'Ei ääniä'}</div></td>
          <td class="num">${n.finalVotes} ${n.finalVotes === 1 ? 'ääni' : 'ääntä'}</td>
        </tr>`).join('') || '<tr><td class="muted">Ei finalisteja.</td></tr>'}</tbody>
    </table></div>`).join('')}
  </div>`;
}

function resultsText() {
  return results().map(({ cat, noms, winners }) => {
    const lines = noms.map((n) => `${winners.includes(n.id) ? '★ ' : '  '}${n.name}${n.reason ? ' – ' + n.reason : ''} (${n.finalVotes}${n.finalVoters.length ? ': ' + n.finalVoters.join(', ') : ''})`);
    return `${cat.name}\n${lines.join('\n')}`;
  }).join('\n\n');
}

// Hall of Fame -lomakkeen kentät luonnokseen. Henkilövalinta ja voittajaruutu piirretään heti uudelleen
// (kuva, nimikenttä, korostus); tekstikentät päivittävät vain luonnoksen.
function hofInput(el, changed) {
  const d = hofDraft; const f = el.dataset.hof;
  const c = d.categories[el.dataset.ci]; const n = c && c.nominees[el.dataset.ni];
  d.dirty = true;
  if (f === 'year') d.year = el.value;
  else if (f === 'cat-name') c.name = el.value;
  else if (f === 'cat-desc') c.description = el.value;
  else if (f === 'name') n.name = el.value;
  else if (f === 'reason') n.reason = el.value;
  else if (f === 'place' && changed) { n.place = Number(el.value) || 0; render(); }
  else if (f === 'person' && changed) {
    n.other = el.value === '__other';
    n.personId = n.other ? '' : el.value;
    render();
    if (n.other) document.getElementById(`hn-${el.dataset.ci}-${el.dataset.ni}`)?.focus();
  }
}

function selectHofYear(year, focus) {
  hofYearSel = year; syncHofUrl(false); render();
  if (focus) document.getElementById(`hof-tab-${year}`)?.focus();
}

// Välilehtien näppäimistökäyttö: nuolet, Home ja End
document.addEventListener('keydown', (e) => {
  const tab = e.target.closest && e.target.closest('.hof-tabs [role="tab"]');
  if (!tab) return;
  const years = (state.hallOfFame || []).map((y) => y.year);
  const i = years.indexOf(Number(tab.dataset.year));
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: years.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  selectHofYear(years[(next + years.length) % years.length], true);
});

// ---------- Tapahtumat ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const id = t.dataset.id;
  switch (t.dataset.act) {
    case 'logout': await api('POST', '/api/logout', {}); state = { ...state, me: null }; render(); break;
    case 'vote-cat': if (isTest()) { simulate('vote-cat', { id }); break; } await api('POST', `/api/categories/${id}/vote`, {}).catch(() => {}); break;
    case 'rank': {
      // Painettu sija uudelleen = poista sijalta
      const place = t.getAttribute('aria-pressed') === 'true' ? 0 : Number(t.dataset.place);
      if (isTest()) { simulate('rank', { id, place }); break; }
      await api('POST', '/api/ranks', { nomineeId: id, place }).catch(() => {}); break;
    }
    case 'test-phase':
      previewPhase = Number(t.dataset.phase); editing = null; proposing = null;
      await refresh(); window.scrollTo(0, 0);
      break;
    case 'test-wait':
      // Hyppää suoraan vaiheen odotusnäyttöön: haetaan vaihe ja merkitään se paikallisesti lukituksi
      previewPhase = Number(t.dataset.phase); editing = null; proposing = null;
      await refresh(); state.me.locked = true; render(); window.scrollTo(0, 0);
      break;
    case 'test-reset': editing = null; proposing = null; await refresh(); toast('Testi aloitettu alusta.'); break;
    case 'test-unlock': state.me.unlockRequested = false; simulate('unlock'); break;
    case 'copy-link': {
      const link = `${location.origin}/?k=${t.dataset.code}`;
      try { await navigator.clipboard.writeText(link); toast(`${t.dataset.name}: linkki kopioitu.`); }
      catch { prompt('Kopioi linkki:', link); }
      break;
    }
    case 'lock':
      if (!confirm(lockWarning() + 'Lukitaanko vastauksesi? Tämän jälkeen et voi enää muuttaa tämän vaiheen valintoja.')) break;
      if (isTest()) { simulate('lock', { msg: 'Lukko sisään! (testi)' }); break; }
      await api('POST', '/api/lock', {}).catch(() => {});
      break;
    case 'user-unlock':
      if (confirm(`Avataanko lukko (${t.dataset.name})? Hän voi taas muuttaa tämän vaiheen valintojaan.`)) await api('POST', `/api/admin/users/${id}`, { unlock: true }).then(() => toast('Lukko avattu.')).catch(() => {});
      break;
    case 'edit': {
      editing = { kind: t.dataset.kind, id, admin: !!t.dataset.admin };
      render();
      const first = document.getElementById(`e1-${t.dataset.kind}-${id}`);
      if (first) { first.focus(); first.select(); }
      break;
    }
    case 'edit-cancel': editing = null; render(); break;
    case 'del-own': {
      const cat = t.dataset.kind === 'cat';
      if (!confirm(cat ? 'Poistetaanko ehdottamasi kategoria?' : 'Poistetaanko ehdotuksesi? Myös muiden sille antamat äänet poistuvat.')) break;
      if (isTest()) { simulate('del', { kind: t.dataset.kind, id, msg: 'Ehdotus poistettu.' }); break; }
      await api('DELETE', `/api/${cat ? 'categories' : 'nominees'}/${id}`, {}).then(() => toast('Ehdotus poistettu.')).catch(() => {});
      break;
    }
    case 'pick-person': {
      proposing = { catId: t.dataset.cat, personId: t.dataset.person };
      render();
      const inp = document.getElementById('pr-' + t.dataset.cat);
      if (inp) inp.focus();
      break;
    }
    case 'pick-cancel': proposing = null; render(); break;
    case 'auto-finalists':
      if (confirm(`Valitaanko jokaiseen kategoriaan ${state.limits.finalists} eniten ääniä saanutta finalistiksi? Nykyiset finalistivalinnat korvataan.`)) await api('POST', '/api/admin/nominees/auto-finalists', {}).catch(() => {});
      break;
    case 'photo-pick':
      uploadTarget = { target: t.dataset.target, id };
      photoInput.click(); // kutsuttava heti klikkauksessa ilman odotuksia, muuten iOS estää valitsimen
      break;
    case 'crop-open': openCrop(t.dataset.target, id); break;
    case 'user-stats':
      try { stats = await api('GET', `/api/admin/users/${id}/stats`); render(); } catch {}
      break;
    case 'stats-close': stats = null; render(); break;
    case 'photos-open': {
      photosOpen = true; meCard = false;
      if (t.dataset.person) versionsOpen.add(t.dataset.person);
      render();
      const card = t.dataset.person && document.getElementById('sugg-' + t.dataset.person);
      if (card) card.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
      if (state.me.admin && !isTest() && state.photoNew) api('POST', '/api/admin/photos-seen', {}).catch(() => {});
      break;
    }
    case 'photos-close': photosOpen = false; previewVersion = null; render(); window.scrollTo(0, 0); break;
    case 'hof-open': hofOpen = true; hofYearSel = null; photosOpen = false; meCard = false; previewVersion = null; syncHofUrl(true); render(); window.scrollTo(0, 0); break;
    case 'hof-close':
      if (hofDraft && hofDraft.dirty && !confirm('Hall of Fame -lomakkeessa on tallentamattomia muutoksia. Hylätäänkö ne?')) break;
      hofOpen = false; hofDraft = null; syncHofUrl(false); render(); window.scrollTo(0, 0); break;
    case 'hof-year': selectHofYear(Number(t.dataset.year)); break;
    case 'hof-publish': {
      const on = !state.admin.hofPublished;
      if (on && !(state.hallOfFame || []).length && !confirm('Hall of Fame on vielä tyhjä. Julkaistaanko silti?')) break;
      if (!confirm(on ? 'Julkaistaanko Hall of Fame kaikille osallistujille?' : 'Piilotetaanko Hall of Fame muilta? Vain adminit näkevät sen.')) break;
      await api('POST', '/api/admin/settings', { hofPublished: on }).then(() => toast(on ? 'Hall of Fame julkaistu.' : 'Hall of Fame piilotettu muilta.')).catch(() => {});
      break;
    }
    case 'hof-edit': openHofDraft(id); render(); document.querySelector('.hof-form')?.scrollIntoView({ block: 'start' }); document.getElementById('hc-0')?.focus({ preventScroll: true }); break;
    case 'hof-edit-cancel':
      if (hofDraft.dirty && !confirm('Hylätäänkö tallentamattomat muutokset?')) break;
      hofDraft = null; render(); break;
    case 'hof-cat-add':
      hofDraft.categories.push(hofCategory()); hofDraft.dirty = true; render();
      document.getElementById(`hc-${hofDraft.categories.length - 1}`)?.focus(); break;
    case 'hof-cat-del': {
      const c = hofDraft.categories[t.dataset.ci];
      const filled = c.name || c.nominees.some((n) => n.personId || n.name || n.reason);
      if (filled && !confirm(`Poistetaanko kategoria${c.name ? ` "${c.name}"` : ''}?`)) break;
      hofDraft.categories.splice(t.dataset.ci, 1); hofDraft.dirty = true; render(); break;
    }
    case 'hof-nom-add': {
      const list = hofDraft.categories[t.dataset.ci].nominees;
      list.push(hofNominee()); hofDraft.dirty = true; render();
      document.getElementById(`hp-${t.dataset.ci}-${list.length - 1}`)?.focus(); break;
    }
    case 'hof-cover-del': if (hofDraft) { hofDraft.cover = null; hofDraft.dirty = true; render(); } break;
    case 'hof-img-del': { const n = hofRow(id); if (n) { n.image = null; n.src = null; n.crop = null; hofDraft.dirty = true; render(); } break; }
    case 'hof-nom-del':
      hofDraft.categories[t.dataset.ci].nominees.splice(t.dataset.ni, 1); hofDraft.dirty = true; render(); break;
    case 'hof-del': {
      const y = (state.hallOfFame || []).find((x) => x.id === id);
      if (!y || !confirm(`Poistetaanko Gaala ${y.year} Hall of Famesta? Tätä ei voi perua.`)) break;
      try { await api('DELETE', `/api/admin/hof/${id}`, {}); hofDraft = null; if (hofYearSel === y.year) hofYearSel = null; syncHofUrl(false); render(); } catch {}
      break;
    }
    case 'hof-archive':
      try { await api('POST', '/api/admin/hof/archive', { year: Number(t.dataset.year) }); hofYearSel = Number(t.dataset.year); syncHofUrl(false); render(); window.scrollTo(0, 0); } catch {}
      break;
    case 'sugg-safe': {
      const x = (state.photoSuggestions || []).find((y) => y.id === id);
      if (!x) break;
      try {
        await api('POST', `/api/admin/photo-suggestions/${id}/safe`, {});
        if (!x.safe) { previewVersion = null; openCrop('safe', x.personId); } // valittiin: heti rajaukseen
      } catch {}
      break;
    }
    case 'unlock-request':
      // Testikäyttäjällä vain paikallisesti; muuten pyyntö palvelimelle, joka ilmoittaa adminien Discord-kanavalle
      if (isTest()) { state.me.unlockRequested = true; render(); break; }
      await api('POST', '/api/unlock-request', {}).catch(() => {});
      break;
    case 'bulletin-preview':
      try { bulletinPreview = (await api('GET', '/api/admin/bulletin-preview')).text; render(); } catch {}
      break;
    case 'bulletin-send':
      if (confirm('Lähetetäänkö tiedote nyt osallistujien kanavalle? Tämän päivän automaattista tiedotetta ei silloin lähetetä erikseen.')) await api('POST', '/api/admin/bulletin-send', {}).catch(() => {});
      break;
    case 'bulletin-remove':
      if (confirm('Poistetaanko osallistujien kanavan webhook? Päivittäiset tiedotteet loppuvat.')) await api('POST', '/api/admin/bulletin-settings', { webhook: '' }).catch(() => {});
      break;
    case 'award-hof': {
      // palkintosivulta Hall of Fameen: muistetaan paluuosoite tälle välilehdelle
      try { sessionStorage.setItem('awardBack', location.pathname); } catch {}
      break; // linkki hoitaa siirtymän
    }
    case 'awards-publish': {
      const on = !state.admin.awards.published;
      if (!confirm(on ? 'Julkaistaanko tulokset palkintosivuilla? Kuka tahansa QR-koodin skannaava näkee sijat.' : 'Piilotetaanko tulokset palkintosivuilta?')) break;
      await api('POST', '/api/admin/settings', { awardsPublished: on }).then(() => toast(on ? 'Tulokset julkaistu palkintosivuilla.' : 'Tulokset piilotettu.')).catch(() => {});
      break;
    }
    case 'award-png':
      if (qrLib) downloadQrPng(awardUrl(t.dataset.token), t.dataset.name);
      break;
    case 'award-svg':
      if (qrLib) downloadQrSvg(awardUrl(t.dataset.token), t.dataset.name);
      break;
    case 'award-svg-all': {
      if (!qrLib) break;
      const A = state.admin.awards; const y = t.dataset.year;
      const items = y ? (A.archived.find((x) => String(x.year) === y) || { categories: [] }).categories : A.current;
      // selain voi kysyä luvan useamman tiedoston lataukseen kerralla
      items.forEach((x, i) => setTimeout(() => downloadQrSvg(awardUrl(x.token), x.name), i * 400));
      break;
    }
    case 'award-print': {
      if (!qrLib) break;
      const A = state.admin.awards; const y = t.dataset.year;
      const items = y ? (A.archived.find((x) => String(x.year) === y) || { categories: [] }).categories : A.current;
      printQrSheet(items, y ? `HerrasmiesKlubi Gaala ${y} · palkintosivut` : 'HerrasmiesKlubi Gaala · palkintosivut');
      break;
    }
    case 'award-edit': awardEdit = awardEdit === id ? null : id; render(); break;
    case 'award-places-save': {
      const places = {};
      document.querySelectorAll('[data-award-place]').forEach((el) => { if (el.value) places[el.dataset.awardPlace] = Number(el.value); });
      try { await api('POST', `/api/admin/awards/${id}/places`, { places }); awardEdit = null; render(); } catch {}
      break;
    }
    case 'award-places-reset':
      try { await api('POST', `/api/admin/awards/${id}/places`, { reset: true }); awardEdit = null; render(); } catch {}
      break;
    case 'notify-test':
      await api('POST', '/api/admin/notify-test', {}).catch(() => {});
      break;
    case 'notify-remove':
      if (confirm('Poistetaanko webhook? Discord-ilmoitukset loppuvat.')) await api('POST', '/api/admin/notify-settings', { webhook: '' }).catch(() => {});
      break;
    case 'safe-del':
      if (confirm('Poistetaanko <18-kuvan valinta? Kuva jää kuvaversioihin.')) await api('DELETE', `/api/admin/users/${id}/safe-photo`, {}).catch(() => {});
      break;
    case 'safe-mode': {
      const on = !state.admin.safeMode;
      const a = state.admin; const missing = a.participants.filter((p) => !p.tester && !p.safePhoto).length;
      if (!confirm(on
        ? `Otetaanko Alle K18 -tila käyttöön? Kaikille näytetään profiilikuvien sijaan <18-kuvat.${missing ? ` ${missing} osallistujalla ei ole <18-kuvaa, joten heille näytetään nimikirjain.` : ''}`
        : 'Poistetaanko Alle K18 -tila käytöstä? Normaalit profiilikuvat palaavat käyttöön.')) break;
      await api('POST', '/api/admin/settings', { safeMode: on }).then(() => toast(on ? 'Alle K18 -tila päällä.' : 'Alle K18 -tila pois päältä.')).catch(() => {});
      break;
    }
    case 'versions-toggle':
      if (versionsOpen.has(id)) versionsOpen.delete(id); else versionsOpen.add(id);
      render(); document.querySelector(`[data-act="versions-toggle"][data-id="${id}"]`)?.focus();
      break;
    case 'version-preview': previewVersion = id; render(); document.querySelector('[data-act="preview-close"]')?.focus(); break;
    case 'version-step': {
      const cur = (state.photoSuggestions || []).find((y) => y.id === previewVersion);
      if (!cur) break;
      const list = versionList(cur.personId); const i = list.findIndex((y) => y.id === cur.id);
      previewVersion = list[(i + Number(t.dataset.step) + list.length) % list.length].id; render();
      document.querySelector(`[data-act="version-step"][data-step="${t.dataset.step}"]`)?.focus();
      break;
    }
    case 'preview-close': {
      const back = previewVersion; previewVersion = null; render();
      document.querySelector(`[data-act="version-preview"][data-id="${back}"]`)?.focus();
      break;
    }
    case 'sugg-del':
      if (isTest()) { state.photoSuggestions = (state.photoSuggestions || []).filter((x) => x.id !== id); render(); toast('Kuvaehdotus poistettu. (testi)'); break; }
      if (confirm(state.me.admin ? 'Poistetaanko kuva pysyvästi? Sitä ei voi palauttaa.' : 'Poistetaanko kuvaehdotus?')) await api('DELETE', `/api/photo-suggestions/${id}`, {}).catch(() => {});
      break;
    case 'sugg-accept': {
      const x = (state.photoSuggestions || []).find((y) => y.id === id);
      if (!x) break;
      const who = ((state.admin ? state.admin.participants : state.people || []).find((p) => p.id === x.personId) || {}).name || 'henkilön';
      if (!confirm(`Vaihdetaanko tämä kuva henkilön ${who} profiilikuvaksi? Nykyinen kuva jää talteen versioihin.`)) break;
      try { await api('POST', `/api/admin/photo-suggestions/${id}/accept`, {}); previewVersion = null; openCrop('user', x.personId); } catch {}
      break;
    }
    case 'me-card': meCard = true; render(); document.querySelector('[data-act="me-close"]')?.focus(); break;
    case 'me-close': meCard = false; render(); document.querySelector('[data-act="me-card"]')?.focus(); break;
    case 'crop-cancel': cropping = null; render(); break;
    case 'crop-reset': cropping.x = 50; cropping.y = 50; cropping.z = 1; applyCropPreview(); break;
    case 'crop-save': {
      const c = cropping;
      if (c.target === 'hofcover') {
        if (hofDraft && hofDraft.cover) { hofDraft.cover.crop = { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 100) / 100 }; hofDraft.dirty = true; toast('Rajaus asetettu. Muista tallentaa Gaala.'); }
        cropping = null; render();
        break;
      }
      if (c.target === 'hof') {
        const n = hofRow(c.id);
        if (n) { n.crop = { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 100) / 100 }; hofDraft.dirty = true; toast('Rajaus asetettu. Muista tallentaa Gaala.'); }
        cropping = null; render();
        break;
      }
      await api('POST', c.target === 'safe' ? `/api/admin/users/${c.id}/safe-crop` : `/api/admin/${c.target === 'user' ? 'users' : 'nominees'}/${c.id}/crop`, { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 100) / 100 })
        .then(() => { cropping = null; render(); }).catch(() => {});
      break;
    }
    case 'reset-gala': {
      const users = !!document.getElementById('reset-users')?.checked;
      const what = users ? 'KAIKKI: ehdotukset, äänet, palautteet JA osallistujat koodeineen' : 'kaikki ehdotukset, ehdokkaat, äänet, lukitukset ja palautteet';
      const typed = prompt(`Tämä poistaa ${what}, ja Gaala alkaa alusta vaiheesta 1.\n\nKirjoita NOLLAA vahvistaaksesi:`);
      if (typed === null) break;
      if (typed.trim() !== 'NOLLAA') { toast('Nollausta ei tehty: vahvistussana ei täsmännyt.', true); break; }
      editing = null; proposing = null; cropping = null; stats = null;
      await api('POST', '/api/admin/reset', { confirm: 'NOLLAA', users }).catch(() => {});
      break;
    }
    case 'fb-del':
      if (confirm('Poistetaanko palaute pysyvästi?')) await api('DELETE', `/api/feedback/${id}`, {}).catch(() => {});
      break;
    case 'photo-del':
      if (confirm(t.dataset.target === 'user' ? 'Poistetaanko profiilikuva käytöstä? Kuva jää kuvaversioihin, josta sen saa takaisin.' : 'Poistetaanko kuva?')) await api('DELETE', `/api/admin/${t.dataset.target === 'user' ? 'users' : 'nominees'}/${id}/photo`, {}).catch(() => {});
      break;
    case 'auto-advance': await api('POST', '/api/admin/categories/auto-advance', {}).catch(() => {}); break;
    case 'user-regen': if (confirm('Luodaanko uusi koodi? Vanha lakkaa toimimasta heti.')) await api('POST', `/api/admin/users/${id}`, { regenerate: true }).catch(() => {}); break;
    case 'user-del': if (confirm('Poistetaanko osallistuja ja hänen äänensä? Hänen ehdotuksensa jäävät.')) await api('DELETE', `/api/admin/users/${id}`, {}).catch(() => {}); break;
    case 'phase': {
      const p = Number(t.dataset.phase);
      if (!confirm(`Vaihdetaanko vaiheeseen ${p}? Kaikki näkevät muutoksen heti.`)) return;
      await api('POST', '/api/admin/phase', { phase: p }).catch(() => {});
      toast('Vaihe vaihdettu.'); break;
    }
    case 'del-cat': if (confirm('Poistetaanko kategoria ja sen ehdokkaat ja äänet?')) await api('DELETE', `/api/admin/categories/${id}`, {}).catch(() => {}); break;
    case 'del-nom': if (confirm('Poistetaanko ehdokas ja sen äänet?')) await api('DELETE', `/api/admin/nominees/${id}`, {}).catch(() => {}); break;
    case 'copy-results': {
      const text = resultsText();
      try { await navigator.clipboard.writeText(text); toast('Tulokset kopioitu leikepöydälle.'); }
      catch { prompt('Kopioi tulokset:', text); }
      break;
    }
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.hof && hofDraft) { hofInput(t, true); return; }
  switch (t.dataset.act) {
    case 'final':
      if (isTest()) { simulate('final', { id: t.value, msg: 'Ääni tallennettu.' }); break; }
      await api('POST', '/api/final', { nomineeId: t.value }).then(() => toast('Ääni tallennettu.')).catch(() => {}); break;
    case 'user-tester': await api('POST', `/api/admin/users/${t.dataset.id}`, { tester: t.checked }).catch(() => {}); break;
    case 'user-nominable': await api('POST', `/api/admin/users/${t.dataset.id}`, { nominable: t.checked }).catch(() => {}); break;
    case 'user-admin': await api('POST', `/api/admin/users/${t.dataset.id}`, { admin: t.checked }).catch(() => {}); break;
    case 'advance': await api('POST', `/api/admin/categories/${t.dataset.id}`, { advanced: t.checked }).catch(() => {}); break;
    case 'finalist': await api('POST', `/api/admin/nominees/${t.dataset.id}`, { finalist: t.checked }).catch(() => {}); break;
    case 'toggle-final-counts': showFinalCounts = t.checked; render(); break;
  }
});

// ---------- Kuvan luku ja pienennys ----------
// HEIC/HEIF: iPhonen Safari avaa HEIC-kuvat itse, mutta Androidin selaimet (Chrome, Brave, Samsung Internet) ja
// useimmat tietokoneselaimet eivät. Silloin kuva puretaan selaimessa libheif-kirjastolla. Ensisijaisesti käytetään
// palvelimelta ladattavaa heic-to-kirjastoa (uusi libheif, osaa myös Samsungin HEIF-kuvat; ~3 Mt, ladataan vain
// tarvittaessa), varalla vanhaa heic2any-kirjastoa CDN:stä.
const HEIC_TO_LIB = '/vendor/heic-to.js'; // heic-to 1.6.6 (iife), MIT
const HEIC_LIB = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
// Kuvan valitsin. Puhelimissa pelkkä image/*:
// - Androidissa image/* avaa kuvagallerian/kameran; tiedostopäätteet listassa pakottaisivat tiedostoselaimen.
// - iPhonessa (ja Macin Safarissa) .heic accept-listassa muuttaa JPEG/PNG-kuvat HEIC:ksi (Safari 17 -bugi).
// Tietokoneen muissa selaimissa lisätään .heic/.heif, jotta tiedostovalitsin näyttää myös ne.
const UA = navigator.userAgent;
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const APPLE_WEBKIT = /iPhone|iPad|iPod/.test(UA) || (/Safari/.test(UA) && !/Chrome|Chromium|Edg|Android/.test(UA));
const PHOTO_ACCEPT = IS_MOBILE || APPLE_WEBKIT ? 'image/*' : 'image/*,.heic,.heif';

// Yksi pysyvä tiedostokenttä #app-alueen ulkopuolella. Sivu piirretään taustalla uudelleen 15 s välein ja
// kun välilehti palaa näkyviin (esim. iPhonen kuvavalitsimen sulkeutuessa). Jos kenttä olisi näkymän sisällä,
// valittu kuva palautuisi jo poistetulle kentälle ja katoaisi. Tätä kenttää uudelleenpiirto ei koske.
let uploadTarget = null; // { target: 'user' | 'nom' | 'sugg' | 'hof', id }
const photoInput = document.createElement('input');
photoInput.type = 'file';
photoInput.accept = PHOTO_ACCEPT;
photoInput.className = 'sr-only';
photoInput.tabIndex = -1;
photoInput.setAttribute('aria-hidden', 'true');
document.body.appendChild(photoInput);
photoInput.addEventListener('change', async () => {
  const file = photoInput.files && photoInput.files[0];
  const tgt = uploadTarget;
  if (!file || !tgt) { photoInput.value = ''; uploadLog({ result: 'peruttu', stage: 'valinta', error: file ? 'kohde puuttui' : 'ei tiedostoa' }); return; }
  // Android: valittu kuva on puhelimen galleriasta lainattu tiedosto, jonka lukulupa voi raueta, kun kenttä
  // tyhjennetään tai aikaa kuluu. Siksi kuva luetaan heti muistiin ja vasta sitten kenttä tyhjennetään.
  toast('Luetaan kuvaa…');
  let copy;
  try {
    copy = await readIntoMemory(file);
  } catch (err) {
    uploadLog({ name: file.name, type: file.type, size: file.size, result: 'virhe', stage: 'valinta/muistiin luku', error: err.detail || err.message });
    toast('Puhelin ei antanut selaimelle lupaa lukea kuvaa. Yritä uudelleen. Jos ei onnistu, avaa sivu Chromessa tai valitse kuva Tiedostot-sovelluksen kautta.', true);
    return;
  } finally {
    photoInput.value = ''; // sama kuva voidaan valita uudelleen
  }
  uploadPhoto(tgt, copy, 'valinta');
});

// Lue valittu tiedosto kokonaan muistiin. Kolme eri tapaa, koska puhelinselaimissa jokin niistä voi epäonnistua
// (esim. Androidin NotReadableError). Palauttaa uuden File-olion, joka ei enää riipu puhelimen tiedostoluvasta.
async function readIntoMemory(file) {
  const tries = [
    ['arrayBuffer', () => file.arrayBuffer()],
    ['FileReader', () => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('FileReader'));
      r.readAsArrayBuffer(file);
    })],
    ['blob-url', async () => {
      const u = URL.createObjectURL(file);
      try { return await (await fetch(u)).arrayBuffer(); } finally { URL.revokeObjectURL(u); }
    }],
  ];
  const errors = [];
  for (const [how, read] of tries) {
    try {
      const buf = await withTimeout(read(), 30000, 'aikakatkaisu');
      if (buf && buf.byteLength) return new File([buf], file.name || 'kuva', { type: file.type || '', lastModified: file.lastModified });
      errors.push(`${how}: tyhjä`);
    } catch (e) {
      errors.push(`${how}: ${(e && e.name) || ''} ${(e && e.message) || e}`.trim());
    }
  }
  const err = new Error('Kuvatiedostoa ei voitu lukea.');
  err.detail = errors.join(' / ').slice(0, 290);
  throw err;
}

// Kirjaa latausyritys palvelimen lokiin vianetsintää varten (ei vaikuta itse lataukseen)
function uploadLog(info) {
  fetch('/api/admin/upload-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...info, ua: navigator.userAgent }) }).catch(() => {});
}

// Yhteinen lataus napille ja raahaukselle: luku → (HEIC-muunnos) → pienennys → lähetys → rajausikkuna
async function uploadPhoto(tgt, file, via) {
  const meta = { name: file.name, type: file.type, size: file.size };
  let stage = 'luku';
  try {
    toast('Ladataan kuvaa…');
    uploadLog({ ...meta, result: 'valittu', stage: via }); // näkyy lokissa heti, vaikka myöhempi vaihe jumittuisi
    const image = await imageToDataUrl(file, 1400, (d) => { meta.dims = d; }, (k) => { meta.kind = k; },
      (step) => { if (step !== 'aloitettu') uploadLog({ ...meta, result: 'vaihe', stage: `${via}/${step}` }); });
    stage = 'lähetys';
    if (tgt.target === 'hofcover') { // Hall of Famen kansikuva: luonnokseen, tallentuu "Tallenna Gaala" -napista
      const r = await api('POST', '/api/admin/hof/image', { image });
      if (hofDraft) { hofDraft.cover = { image: r.image, src: r.src, crop: null }; hofDraft.dirty = true; openCrop('hofcover', 'cover'); }
      uploadLog({ ...meta, result: 'onnistui', stage: `${via}/hofcover` });
      return;
    }
    if (tgt.target === 'hof') { // Hall of Famen oma kuva: liitetään lomakkeen riviin, tallentuu "Tallenna Gaala" -napista
      const r = await api('POST', '/api/admin/hof/image', { image });
      const n = hofRow(tgt.id);
      if (n) { n.image = r.image; n.src = r.src; n.crop = null; hofDraft.dirty = true; openCrop('hof', tgt.id); } // heti rajaukseen, kuten profiilikuvissa
      uploadLog({ ...meta, result: 'onnistui', stage: `${via}/hof` });
      return;
    }
    if (tgt.target === 'sugg') {
      if (isTest()) { // testikäyttäjä: kuva näkyy vain omassa selaimessa
        state.photoSuggestions = [...(state.photoSuggestions || []), { id: 'test-' + Date.now(), personId: tgt.id, src: image, createdAt: new Date().toISOString(), mine: true, byName: state.me.name }];
        render(); toast('Kuvaehdotus lisätty. (testi, ei tallennettu)'); return;
      }
      await api('POST', '/api/photo-suggestions', { personId: tgt.id, image });
      uploadLog({ ...meta, result: 'onnistui', stage: `${via}/ehdotus` });
      return;
    }
    await api('POST', `/api/admin/${tgt.target === 'user' ? 'users' : 'nominees'}/${tgt.id}/photo`, { image });
    uploadLog({ ...meta, result: 'onnistui', stage: via });
    openCrop(tgt.target, tgt.id); // heti rajaukseen ja esikatseluun
  } catch (err) {
    uploadLog({ ...meta, result: 'virhe', stage: `${via}/${stage}`, error: err && (err.detail ? `${err.message} (${err.detail})` : err.message) });
    if (err && err.message && stage === 'luku') toast(err.message, true); // lähetysvirheen api() näytti jo
  }
}

// Liitä (Ctrl+V / Cmd+V): Hall of Fame -lomakkeessa leikepöydän kuva menee riville, jolla kursori on
// (esim. "Mistä?"-kenttä) tai jonka päällä hiiri on. Selaimesta kopioidun kuvan mukana tulee usein myös
// tekstiä (kuvan osoite), joten rivillä kuva voittaa aina tekstin. Muualla teksti liitetään normaalisti.
function pastedImage(cd) {
  if (!cd) return null;
  const item = Array.from(cd.items || []).find((x) => x.kind === 'file' && /^image\//.test(x.type));
  const f = item && item.getAsFile();
  if (f) return f;
  // Resurssienhallinnasta kopioitu tiedosto tulee joissain selaimissa vain files-listassa (ja tyyppi voi puuttua)
  return Array.from(cd.files || []).find((x) => /^image\//.test(x.type) || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(x.name)) || null;
}

// Kuvan osoite leikepöydän HTML:stä tai tekstistä. Verkkosivulta Ctrl+C:llä kopioitu kuva (tai osa sivua)
// tulee HTML-pätkänä, jossa on <img src="...">; jotkin sovellukset upottavat kuvan data:-osoitteena.
function pastedImageUrl(html, text) {
  if (html) {
    const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]');
    if (img) return img.getAttribute('src');
  }
  const t = String(text || '').trim();
  return /^data:image\//i.test(t) || /^https?:\/\/\S+\.(jpe?g|png|webp|gif|avif)(\?\S*)?$/i.test(t) ? t : '';
}

const PASTE_HELP = 'Kokeile: klikkaa kuvaa hiiren oikealla → "Kopioi kuva", tai tallenna kuva koneelle ja raahaa se riville.';

// Kuva liitetystä osoitteesta tai suoraan leikepöydältä (jos selain ei antanut kuvaa liittämistapahtumassa)
async function resolvePastedImage(url, types) {
  if (url) {
    try {
      const res = await fetch(url, { credentials: 'omit' }); // data: aina, muut sivustot vain jos ne sallivat
      const blob = await res.blob();
      if (res.ok && /^image\//.test(blob.type)) return new File([blob], `liitetty.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: blob.type });
    } catch { /* toinen sivusto estää latauksen */ }
    // Google Slides / Docs: kuva on Googlen palvelimella, jota selain ei saa ladata; palvelin hakee sen
    if (/^https:\/\/[^/]*googleusercontent\.com\//i.test(url)) {
      const res = await fetch('/api/admin/fetch-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ url }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kuvan haku epäonnistui.');
      const blob = await (await fetch(data.image)).blob();
      return new File([blob], `liitetty.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: blob.type });
    }
  }
  if (navigator.clipboard && navigator.clipboard.read) {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => /^image\//.test(t));
        if (type) { const blob = await item.getType(type); return new File([blob], `liitetty.${type.split('/')[1]}`, { type }); }
      }
    } catch { /* lupa evätty tai ei tuettu */ }
  }
  throw new Error(url && !/^data:/i.test(url)
    ? `Leikepöydällä on vain linkki kuvaan toisella sivustolla, eikä se sivusto anna ladata kuvaa. ${PASTE_HELP}`
    : `Leikepöydältä ei löytynyt kuvaa (sisältö: ${types || 'tyhjä'}). ${PASTE_HELP}`);
}

document.addEventListener('paste', (e) => {
  if (!hofOpen || !state || !state.me || !state.me.admin || cropping) return;
  const cd = e.clipboardData;
  const file = pastedImage(cd);
  const types = Array.from((cd && cd.types) || []).join(', ');
  const url = file ? '' : pastedImageUrl(cd && cd.getData('text/html'), cd && cd.getData('text/plain'));
  const a = document.activeElement;
  const inText = !!(a && /INPUT|TEXTAREA/.test(a.tagName) && !['checkbox', 'radio'].includes(a.type));
  const ZONE = '.hof-edit-nom, .hof-cover-edit'; // ehdokkaan rivi tai kansikuva-alue
  const row = hofDraft ? ((a && a.closest && a.closest(ZONE)) || document.querySelector('.hof-edit-nom:hover, .hof-cover-edit:hover')) : null;
  // Vianetsintä palvelimen lokiin (terminaali / docker logs: [kuvalataus]): mitä leikepöydältä tuli
  uploadLog({ name: file ? file.name : '', type: file ? file.type : '', size: file ? file.size : 0, result: 'liitä', stage: `liitä/${file ? 'kuva' : url ? 'kuvan osoite' : 'ei kuvaa'}${row ? ' rivillä' : ''}${hofDraft ? '' : ' (lomake kiinni)'}`, error: `tyypit: ${types || '-'}${url ? ` | osoite: ${url.slice(0, 80)}` : ''}` });
  if (!hofDraft) {
    if (inText || (!file && !url)) return;
    e.preventDefault();
    toast('Avaa ensin Gaalan muokkaus ("Muokkaa" tai "+ Lisää aiempi Gaala") ja liitä kuva ehdokkaan riville.', true);
    return;
  }
  if (!row) {
    if (inText) return; // esim. kategorian nimi: teksti liitetään normaalisti
    e.preventDefault();
    if (file || url) toast('Klikkaa ensin ehdokkaan riviä (esim. "Mistä?"-kenttää) tai kansikuvan aluetta ja liitä kuva sitten.', true);
    return;
  }
  // Tekstikenttään liitetty pelkkä teksti menee tekstinä; kaikki muu rivillä yritetään kuvaksi
  if (!file && !url && inText) return;
  e.preventDefault();
  const target = { target: row.dataset.dropTarget, id: row.dataset.dropId };
  (file ? Promise.resolve(file) : resolvePastedImage(url, types))
    .then((f) => readIntoMemory(f))
    .then((copy) => uploadPhoto(target, copy, 'liitä'))
    .catch((err) => { uploadLog({ result: 'virhe', stage: 'liitä/kuvan haku', error: `${err.detail || err.message} | tyypit: ${types || '-'}` }); toast(err.message || 'Kuvaa ei voitu lukea.', true); });
});

// Raahaa ja pudota: kuvan voi pudottaa osallistujan tai ehdokkaan riville hallinnassa
const dragFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
document.addEventListener('dragover', (e) => {
  if (!dragFiles(e)) return;
  e.preventDefault(); // estää selainta avaamasta tiedostoa, jos se pudotetaan ohi
  const zone = e.target.closest && e.target.closest('[data-drop-target]');
  document.querySelectorAll('.drop-hover').forEach((el) => { if (el !== zone) el.classList.remove('drop-hover'); });
  if (zone) { zone.classList.add('drop-hover'); e.dataTransfer.dropEffect = 'copy'; } else e.dataTransfer.dropEffect = 'none';
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover')); });
document.addEventListener('drop', (e) => {
  if (!dragFiles(e)) return;
  e.preventDefault();
  document.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
  const zone = e.target.closest && e.target.closest('[data-drop-target]');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!zone || !file) { if (file) toast('Pudota kuva kortin tai rivin päälle.', true); return; }
  readIntoMemory(file)
    .then((copy) => uploadPhoto({ target: zone.dataset.dropTarget, id: zone.dataset.dropId }, copy, 'raahaus'))
    .catch((err) => { uploadLog({ name: file.name, type: file.type, size: file.size, result: 'virhe', stage: 'raahaus/muistiin luku', error: err.detail || err.message }); toast('Kuvaa ei voitu lukea.', true); });
});

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => (img.naturalWidth ? resolve({ img, url }) : (URL.revokeObjectURL(url), reject(new Error('tyhjä kuva'))));
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ei luettavissa')); };
    img.src = url;
  });
}

// Lupaus, joka hylätään, jos se ei valmistu ajassa: mikään vaihe ei saa jäädä jumiin ilman virheilmoitusta
const withTimeout = (promise, ms, msg) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

const scriptCache = {};
function loadScript(src, globalName) {
  scriptCache[src] = scriptCache[src] || withTimeout(new Promise((resolve, reject) => {
    if (window[globalName]) return resolve(window[globalName]);
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error('kirjasto ei latautunut')));
    el.onerror = () => { el.remove(); reject(new Error('kirjaston lataus estettiin')); };
    document.head.appendChild(el);
  }), 30000, 'kirjaston lataus aikakatkaistiin').catch((e) => { delete scriptCache[src]; throw e; });
  return scriptCache[src];
}

// HEIC → piirrettävä kuva. Palauttaa { source, width, height, done }.
async function decodeHeic(file, log) {
  try {
    const heicTo = await loadScript(HEIC_TO_LIB, 'HeicTo');
    const bmp = await withTimeout(heicTo({ blob: file, type: 'bitmap' }), 90000, 'HEIC-muunnos kesti liian kauan');
    return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close && bmp.close() };
  } catch (err) {
    log(`heic-to: ${err && (err.message || err)}`);
  }
  const heic2any = await loadScript(HEIC_LIB, 'heic2any');
  const out = await withTimeout(heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 }), 90000, 'HEIC-muunnos kesti liian kauan');
  const { img, url } = await loadImage(Array.isArray(out) ? out[0] : out);
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

// Tunnista kuvan muoto tiedoston alusta. Puhelimet antavat joskus väärän tai tyhjän tyypin ja nimen
// (esim. Androidin galleriasovellukset, Google Kuvat, iPhonen Tiedostot), joten luotetaan sisältöön.
// 'unreadable' = tiedostoa ei voitu lukea lainkaan (esim. pilvessä oleva kuva, jota ei ole ladattu puhelimeen).
async function sniffImage(file) {
  let b;
  try {
    b = new Uint8Array(await withTimeout(file.slice(0, 16).arrayBuffer(), 15000, 'luku aikakatkaistiin'));
  } catch {
    return 'unreadable';
  }
  if (!b.length) return 'unreadable';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  const box = String.fromCharCode(...b.slice(4, 12));
  if (box.startsWith('ftyp')) {
    const brand = box.slice(4);
    if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)/.test(brand)) return 'heic'; // iPhone, Samsungin HEIF
    if (/^avi[fs]/.test(brand)) return 'avif';
  }
  return /\.(heic|heif)$/i.test(file.name || '') || /hei[cf]/i.test(file.type || '') ? 'heic' : 'unknown';
}

const readAsDataUrl = (blob) => withTimeout(new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('Kuvan lukeminen epäonnistui.'));
  r.readAsDataURL(blob);
}), 30000, 'Kuvan lukeminen aikakatkaistiin.');

// Pienennä kuva ennen lähetystä: pidempi sivu max 1400 px (riittää zoomaukseen), JPEG-laatu 0,85.
// Järjestys: 1) selaimen oma avaus (iPhone avaa myös HEIC:n), 2) HEIC-muunnos libheifillä (Android ja
// tietokoneet), 3) jos kuva on valmiiksi JPEG/PNG/WebP mutta pienennys ei onnistu (esim. muisti loppuu
// jättikuvan kanssa), lähetetään alkuperäinen sellaisenaan (max 8 Mt).
// onStep kertoo etenemisen lokiin, jotta mahdollinen jumi näkyy palvelimen lokissa.
async function imageToDataUrl(file, max = 1400, onDims = () => {}, onKind = () => {}, onStep = () => {}) {
  const kind = await sniffImage(file);
  onKind(kind);
  if (kind === 'unreadable') throw new Error('Kuvatiedostoa ei voitu lukea. Yritä uudelleen tai valitse toinen kuva.');
  onStep('aloitettu');
  const original = async () => {
    if (['jpeg', 'png', 'webp'].includes(kind) && file.size <= 8 * 1024 * 1024) {
      onStep('lähetetään alkuperäinen');
      const url = await readAsDataUrl(file);
      return url.replace(/^data:[^;,]*/, `data:image/${kind}`); // tyyppi sisällön mukaan
    }
    return null;
  };
  let pic = null;
  if (kind === 'heic') {
    // Kokeillaan ensin selaimen omaa avausta (Safari), sitten libheif
    try { const { img, url } = await withTimeout(loadImage(file), 20000, 'avaus aikakatkaistiin'); pic = { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) }; } catch { /* jatketaan */ }
    if (!pic) {
      toast('Muunnetaan HEIC-kuvaa… tämä voi kestää hetken.');
      onStep('HEIC-muunnos');
      try { pic = await decodeHeic(file, onStep); } catch (err) { onStep(`HEIC epäonnistui: ${err && (err.message || err)}`); }
    }
    if (!pic) throw new Error('HEIC-kuvan muunnos epäonnistui. Kokeile toista kuvaa, ota kuvakaappaus kuvasta tai vaihda kameran tallennusmuodoksi JPEG (Samsung: Kamera → asetukset → Kuvamuodot → poista Tehokkaat kuvat / HEIF, iPhone: Asetukset → Kamera → Muodot → Yhteensopivin).');
  } else {
    try { const { img, url } = await withTimeout(loadImage(file), 30000, 'avaus aikakatkaistiin'); pic = { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) }; } catch (err) { onStep(`avaus epäonnistui: ${err && err.message}`); }
    if (!pic) {
      const raw = await original();
      if (raw) return raw;
      throw new Error(kind === 'unknown' ? 'Tiedosto ei näytä kuvalta. Kokeile JPEG-, PNG- tai HEIC-kuvaa.' : 'Kuvaa ei voitu avata. Kokeile toista kuvaa tai kuvakaappausta.');
    }
  }
  try {
    onDims(`${pic.width}x${pic.height}`);
    const scale = Math.min(1, max / Math.max(pic.width, pic.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(pic.width * scale));
    c.height = Math.max(1, Math.round(pic.height * scale));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height); // läpinäkyvä PNG ei muutu JPEG:ssä sotkuksi
    ctx.drawImage(pic.source, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.85);
    if (url.length > 1000) return url;
    throw new Error('tyhjä canvas'); // muisti loppui tai selain esti piirron
  } catch (err) {
    onStep(`pienennys epäonnistui: ${err && err.message}`);
    const raw = await original();
    if (raw) return raw;
    throw new Error('Kuvan pienentäminen epäonnistui. Kokeile pienempää kuvaa tai kuvakaappausta.');
  } finally {
    pic.done();
  }
}

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  const v = (id) => (document.getElementById(id)?.value || '').trim();
  const clear = (...ids) => ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  try {
    if (f.id === 'login-form') {
      await api('POST', '/api/login', { code: v('l-code') });
      clear('l-code');
    } else if (f.id === 'users-form') {
      await api('POST', '/api/admin/users', { names: v('u-names') });
      clear('u-names');
      toast('Koodit luotu.');
    } else if (f.id === 'cat-form') {
      if (isTest()) { if (simulate('add-cat', { name: v('c-name'), description: v('c-desc'), msg: 'Kategoria ehdotettu.' })) clear('c-name', 'c-desc'); return; }
      await api('POST', '/api/categories', { name: v('c-name'), description: v('c-desc') });
      clear('c-name', 'c-desc');
      toast('Kategoria ehdotettu.');
    } else if (f.dataset.form === 'nom') {
      const cid = f.dataset.cat; const reason = v('pr-' + cid);
      if (isTest()) { proposing = null; if (simulate('add-nom', { categoryId: cid, personId: f.dataset.person, reason, msg: 'Ehdokas lisätty. Muista myös äänestää.' })) clear('pr-' + cid); return; }
      await api('POST', '/api/nominees', { categoryId: cid, personId: f.dataset.person, reason });
      clear('pr-' + cid);
      proposing = null; render();
      toast('Ehdokas lisätty. Muista myös äänestää.');
    } else if (f.dataset.form === 'edit') {
      const { kind, id } = f.dataset; const admin = !!f.dataset.admin; const k = `${kind}-${id}`;
      const body = kind === 'cat' ? { name: v('e1-' + k), description: v('e2-' + k) }
        : f.dataset.person ? { personId: v('e1-' + k), reason: v('e2-' + k) } : { name: v('e1-' + k), reason: v('e2-' + k) };
      const base = kind === 'cat' ? 'categories' : 'nominees';
      if (isTest() && !admin) { editing = null; simulate('edit', { kind, id, body, msg: 'Muutokset tallennettu.' }); return; }
      await api('POST', admin ? `/api/admin/${base}/${id}` : `/api/${base}/${id}/edit`, body);
      editing = null; render();
      toast('Muutokset tallennettu.');
    } else if (f.dataset.form === 'hof') {
      const d = hofDraft;
      await api('POST', '/api/admin/hof', {
        id: d.id || undefined, year: d.year,
        cover: d.cover ? { image: d.cover.image, crop: d.cover.crop } : null,
        categories: d.categories.map((c) => ({ name: c.name, description: c.description, awardToken: c.awardToken, nominees: c.nominees.map((n) => ({ personId: n.personId || null, name: n.other ? n.name : '', reason: n.reason, place: n.place || null, winner: n.place === 1, image: n.image, crop: n.crop })) })),
      });
      hofDraft = null; hofYearSel = Number(d.year); syncHofUrl(false); render(); // tallennettu vuosi näkyviin
      document.querySelector('.hof-tabs, .hof-year')?.scrollIntoView({ block: 'start' });
    } else if (f.id === 'feedback-form') {
      const text = v('fb-text');
      if (!text) return;
      if (isTest()) { simulate('feedback', { text, msg: 'Palaute lähetetty.' }); clear('fb-text'); return; }
      await api('POST', '/api/feedback', { text });
      clear('fb-text');
    } else if (f.id === 'award-base-form') {
      await api('POST', '/api/admin/settings', { awardBaseUrl: v('aw-base') });
    } else if (f.id === 'bulletin-form') {
      const body = { roleId: v('b-role'), time: v('b-time'), names: !!document.getElementById('b-names')?.checked, skip: [...document.querySelectorAll('[data-bskip]:checked')].map((x) => x.dataset.bskip) };
      const url = v('b-url');
      if (url) body.webhook = url;
      await api('POST', '/api/admin/bulletin-settings', body);
      clear('b-url');
    } else if (f.id === 'notify-form') {
      const body = { kinds: Object.fromEntries(Object.keys(NOTIFY_LABELS).map((k) => [k, !!document.getElementById(`n-k-${k}`)?.checked])), reminderTime: v('n-time') };
      const url = v('n-url');
      if (url) body.webhook = url;
      await api('POST', '/api/admin/notify-settings', body);
      clear('n-url');
    } else if (f.id === 'settings-form') {
      await api('POST', '/api/admin/settings', { deadline: '', phaseEnds: { 1: v('s-end1'), 2: v('s-end2'), 3: v('s-end3'), 4: v('s-end4'), 5: v('s-end5') }, nextStart: v('s-next'), targetCategories: v('s-tc'), catVotes: v('s-cv'), maxCategoryProposals: v('s-mc'), maxNomineeProposals: v('s-mn'), finalists: v('s-fi') });
      toast('Asetukset tallennettu.');
    }
  } catch { /* virhe näytetty toastina */ }
});


// Päivitä tila taustalla (ei kun käyttäjä kirjoittaa)
setInterval(() => {
  if (AWARD_TOKEN) { if (!document.hidden && award && !award.published) loadAward(); return; } // paljastus näkyy ilman päivitystä
  if (document.hidden || cropping || stats || isTest()) return;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio') return;
  (async () => {
  const k = new URLSearchParams(location.search).get('k');
  if (k) {
    history.replaceState(null, '', location.pathname + location.hash); // Hall of Famen vuosi säilyy
    try { await api('POST', '/api/login', { code: k }); return; } catch {}
  }
  refresh();
})();
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !isTest() && !AWARD_TOKEN) refresh(); });

(async () => {
  if (AWARD_TOKEN) return loadAward();
  const k = new URLSearchParams(location.search).get('k');
  if (k) {
    history.replaceState(null, '', location.pathname + location.hash); // Hall of Famen vuosi säilyy
    try { await api('POST', '/api/login', { code: k }); return; } catch {}
  }
  refresh();
})();
