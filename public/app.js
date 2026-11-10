'use strict';
/* Default Settings Gaala – käyttöliittymä (ei riippuvuuksia) */

let state = null;
let showFinalCounts = false;
// Muokattavana oleva kohde: { kind: 'cat' | 'nom', id, admin } tai null.
// Säilyy uudelleenpiirroissa (myös 15 s automaattipäivityksessä), joten keskeneräinen muokkaus ei katoa.
let editing = null;
// Ehdokasvaiheessa valittu henkilökortti: { catId, personId } tai null (perusteen kirjoittaminen kesken)
let proposing = null;
// Rajausikkuna (vain admin): { target: 'user' | 'nom', id, src, x, y, z, name, reason } tai null
let cropping = null;

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
    if (data && 'phase' in data) { state = data; render(); }
    if (data && data.notice) toast(data.notice);
    return data;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}
const refresh = () => api('GET', '/api/state').catch(() => {});

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

  app.innerHTML = state.me ? mainView() : loginView();

  for (const [id, v] of Object.entries(kept)) { const el = document.getElementById(id); if (el && v) el.value = v; }
  if (active) { const el = document.getElementById(active); if (el) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel); } catch {} } }
}

// ---------- Kirjautuminen ----------
function brand() {
  return `<a class="brand" href="/" aria-label="Default Settings Gaala"><img class="brand-trophy" src="/logo.svg" alt="" width="108" height="236"><span class="brand-text" aria-hidden="true"><span class="brand-eyebrow">Default Settings</span><span class="brand-name">Gaala</span></span></a>`;
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
          <p class="lead">Ensin päätetään kategoriat, sitten ehdokkaat ja lopuksi voittajat. Voittajat paljastetaan gaalassa.</p>
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
    <div class="whoami"><span class="muted">${esc(s.me.name)}${s.me.admin ? ' · admin' : ''}</span><button class="btn btn--ghost" data-act="logout">Kirjaudu ulos</button></div>
  </div></header>
  <main class="wrap">
    <section class="hero">
      ${stepper()}
      ${isWaiting() ? '' : phaseHero()}
    </section>
    ${s.me.root ? `<div class="panel"><p class="eyebrow">Ylläpitotunnus</p><p style="margin:0">Tällä tunnuksella hallinnoidaan, mutta ei äänestetä. Lisää itsesi osallistujaksi alta, anna itsellesi admin-oikeus ja kirjaudu omalla koodillasi.</p></div>` : phaseBody()}
    ${s.me.admin ? adminView() : ''}
    <footer class="footer">
      <span>Default Settings Gaala</span>
    </footer>
  </main>
  ${cropping ? cropView() : ''}`;
}

function stepper() {
  const names = ['Ehdotukset', 'Kategoriat', 'Ehdokkaat', 'Finaali', 'Suljettu'];
  return `<ol class="stepper">${names.map((n, i) => {
    const p = i + 1; const cls = p < state.phase ? 'done' : p === state.phase ? 'now' : '';
    return `<li class="${cls}" ${p === state.phase ? 'aria-current="step"' : ''}>${p < 5 ? 'Vaihe ' + p : 'Lopuksi'}<b>${n}</b></li>`;
  }).join('')}</ol>`;
}

function pips(used, total) {
  return `<span class="pips" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('')}</span>`;
}

function deadline() {
  return state.deadline ? `<span class="small muted">Vaihe päättyy: <b style="color:var(--ink);font-weight:500">${esc(state.deadline)}</b></span>` : '';
}

function phaseHero() {
  const s = state; const L = s.limits;
  if (s.phase === 1) {
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 1 / 4 · Kategoriaehdotukset</p>
      <h1 class="h1">Mistä palkintoja jaetaan?</h1>
      <p class="lead">Ehdota kategorioita, joista gaalassa voisi jakaa palkinnon. Voit ehdottaa enintään ${L.maxCategoryProposals} kategoriaa. Ehdotukset eivät ole ääniä: seuraavassa vaiheessa kaikki äänestävät, mitkä kategoriat pääsevät gaalaan.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(s.used.catProposals, L.maxCategoryProposals)} Ehdotuksia käytetty ${s.used.catProposals} / ${L.maxCategoryProposals}</span>${deadline()}</div>`;
  }
  if (s.phase === 2) {
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 2 / 4 · Kategoria-äänestys</p>
      <h1 class="h1">Mitkä kategoriat gaalaan?</h1>
      <p class="lead">Gaalassa jaetaan ${L.targetCategories} palkintoa. ”Vuoden sykähdyttävin hetki” on mukana joka tapauksessa, ja loput ${L.advanceCount} valitaan äänestämällä. Sinulla on ${L.catVotes} ääntä, enintään yksi per kategoria.</p>
      <p class="notice"><b>Äänestä vähintään yhtä kategoriaa</b> ennen kuin lukitset vastauksesi.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(s.used.catVotes, L.catVotes)} Ääniä käytetty ${s.used.catVotes} / ${L.catVotes}</span>${deadline()}</div>`;
  }
  if (s.phase === 3) {
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 3 / 4 · Ehdokkaat</p>
      <h1 class="h1">Keitä palkitaan?</h1>
      <p class="lead">Kategoriat on valittu. Ehdota henkilöitä valitsemalla kortti ja kirjoittamalla mistä (enintään ${L.maxNomineeProposals} per kategoria). Saman henkilön voi ehdottaa useammasta eri aiheesta.</p>
      <p class="notice"><b>Muista myös äänestää.</b> Ehdottaminen ei anna ääntä. Sinulla on ${L.votesP2} ääntä jokaisessa kategoriassa, ja ne kaikki pitää käyttää ennen lukitsemista.</p>
    </div>
    <div class="meta-row">${deadline()}</div>`;
  }
  if (s.phase === 4) {
    const cats = s.categories; const done = cats.filter((c) => s.nominees.some((n) => n.categoryId === c.id && n.myFinal)).length;
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 4 / 4 · Finaali</p>
      <h1 class="h1">Valitse voittajat</h1>
      <p class="lead">Valitse kortti jokaisesta kategoriasta – yksi ääni per kategoria. Voit vaihtaa valintaasi, kunnes lukitset vastauksesi. Lukitseminen vaatii vähintään yhden äänen.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(done, cats.length)} Äänestetty ${done} / ${cats.length} kategoriaa</span>${deadline()}</div>`;
  }
  return `<div class="hero-head screen-center">
    <p class="eyebrow">Äänestys päättyi</p>
    <h1 class="display">Äänestys on suljettu</h1>
    <p class="lead">Kiitos äänistä! Voittajat julkistetaan gaalassa.</p>
  </div>`;
}

// Osallistuja on lukinnut tämän vaiheen, eikä seuraava ole vielä alkanut
function isWaiting() {
  return !!(state.me && !state.me.root && state.me.locked && state.phase <= 4);
}

function phaseBody() {
  if (isWaiting()) return waitingView();
  if (state.phase === 1) return phaseProposals() + lockBar();
  if (state.phase === 2) return phaseCategoryVote() + lockBar();
  if (state.phase === 3) return phaseNominees() + lockBar();
  if (state.phase === 4) return phaseFinal() + lockBar();
  return feedbackView();
}

// ---------- Lukitus ("Lukko sisään") ----------
function lockBar() {
  const what = { 1: 'ehdotuksiasi', 2: 'ääniäsi', 3: 'ääniäsi ja ehdotuksiasi', 4: 'finaaliääniäsi' }[state.phase];
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
  if (s.phase === 3) return '';
  if (s.phase === 4) {
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
  } else {
    rows = s.categories.map((c) => {
      const picks = s.nominees.filter((n) => n.categoryId === c.id && (s.phase === 3 ? n.myVote : n.myFinal)).map((n) => n.name);
      return [c.name, picks.length ? picks.join(', ') : 'Ei ääntä'];
    });
  }
  const last = s.phase === 4;
  return `
  <section class="section screen-center">
    <div class="panel lock-panel is-locked">
      <img class="lock-trophy" src="/logo.svg" alt="" width="108" height="236">
      <p class="eyebrow">Lukko sisään · vaihe ${s.phase} / 4</p>
      <h1 class="h1">${last ? 'Äänesi on lukittu' : 'Seuraava vaihe ei ole vielä alkanut'}</h1>
      <p class="muted" style="margin:0;max-width:52ch">${last ? 'Kiitos äänistä! Voittajat julkistetaan gaalassa.' : 'Olet jo vastannut tähän vaiheeseen. Odota, että järjestäjät avaavat seuraavan vaiheen – sivu päivittyy itsestään.'}</p>
      <dl class="lock-summary">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <p class="small muted" style="margin:0">Haluatko muuttaa jotain? Pyydä järjestäjää avaamaan lukko.</p>
    </div>
  </section>`;
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

// Vaihe 2: äänestys gaalaan pääsevistä kategorioista
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

// Vaihe 3: ehdokkaat. Ehdotetaan valitsemalla henkilökortti ja kirjoittamalla peruste; äänestetään erikseen.
function phaseNominees() {
  const s = state; const L = s.limits;
  return s.categories.map((c, idx) => {
    const noms = s.nominees.filter((n) => n.categoryId === c.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'fi') || a.reason.localeCompare(b.reason, 'fi'));
    const used = noms.filter((n) => n.myVote).length;
    const need = Math.min(L.votesP2, noms.length);
    const full = used >= L.votesP2;
    const myProps = noms.filter((n) => n.mine).length;
    const propsLeft = L.maxNomineeProposals - myProps;
    const picked = proposing && proposing.catId === c.id ? (s.people || []).find((p) => p.id === proposing.personId) : null;
    return `
    <section class="section" id="cat-${c.id}">
      <header class="cat-head">
        <p class="eyebrow">Kategoria ${String(idx + 1).padStart(2, '0')}</p>
        <div class="row"><h2 class="h2">${esc(c.name)}</h2><span class="meter small">${pips(used, L.votesP2)} Ääniä käytetty ${used} / ${L.votesP2}</span></div>
        ${c.description ? `<p class="muted" style="margin:0">${esc(c.description)}</p>` : ''}
      </header>
      ${noms.length ? `
      ${used < need ? `<p class="notice small">Äänestä vielä ${need - used} ehdokasta tässä kategoriassa.</p>` : ''}
      <div class="nom-grid">
        ${noms.map((n) => `
        <article class="nom-card ${n.myVote ? 'is-voted' : ''}">
          <div class="nom-media">${portrait(n)}${n.mine ? '<span class="tag nom-tag">Sinun ehdotuksesi</span>' : ''}</div>
          ${isEditing('nom', n.id, false) ? `<div class="nom-body">${editForm('nom', n, false)}</div>` : `<div class="nom-body">
            <h3 class="h3">${esc(n.name)}</h3>
            <p>${esc(n.reason)}</p>
            ${n.mine ? `<div class="item-actions">${editButton('nom', n.id, false)}${deleteButton('nom', n.id)}</div>` : ''}
          </div>
          <button class="btn btn--sm ${n.myVote ? 'btn--voted' : 'btn--secondary'}" data-act="vote-nom" data-id="${n.id}" aria-pressed="${n.myVote}" ${!n.myVote && full ? 'disabled title="Kategorian äänet käytetty"' : ''}>${n.myVote ? 'Äänestetty' : 'Äänestä'}</button>`}
        </article>`).join('')}
      </div>` : '<div class="empty">Ei vielä ehdokkaita. Ehdota ensimmäinen alla.</div>'}
      <div class="panel propose-panel">
        <div class="cat-head" style="border:0;padding:0"><p class="eyebrow">Ehdota ehdokasta</p><p class="small muted" style="margin:0">${propsLeft > 0 ? `Valitse henkilö ja kirjoita mistä. Ehdotuksia jäljellä ${propsLeft} / ${L.maxNomineeProposals}. Ehdottaminen ei anna ääntä.` : `Olet käyttänyt kaikki ${L.maxNomineeProposals} ehdotustasi tässä kategoriassa. Voit poistaa oman ehdotuksesi, jos haluat ehdottaa jotain muuta.`}</p></div>
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

// Vaihe 4: finaali pystykortteina. Koko kortti on valintanappi (radio), joten valinta toimii myös näppäimistöllä.
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
  const phaseNames = { 1: 'Kategoriaehdotukset', 2: 'Kategoria-äänestys', 3: 'Ehdokkaat', 4: 'Finaali', 5: 'Suljettu' };
  return `
  <section class="admin" aria-labelledby="admin-h">
    <header class="cat-head"><p class="eyebrow">Vain järjestäjille</p><h2 class="h2" id="admin-h">Hallinta</h2></header>

    <div class="admin-grid">
      <div class="panel">
        <p class="eyebrow">Vaihe</p>
        <p style="margin:0">Nyt: <b>${s.phase}. ${phaseNames[s.phase]}</b></p>
        <div class="phase-btns">${[1, 2, 3, 4, 5].filter((p) => p !== s.phase).map((p) => `<button class="btn btn--sm ${p === s.phase + 1 ? 'btn--primary' : 'btn--secondary'}" data-act="phase" data-phase="${p}">${p > s.phase ? 'Siirry' : 'Palaa'}: ${phaseNames[p]}</button>`).join('')}</div>
      </div>
      <div class="panel">
        <p class="eyebrow">Osallistujat</p>
        <p style="margin:0" class="h3">${a.participants.length} koodia · ${a.participants.filter((p) => p.joined).length} kirjautunut</p>
        <p class="small muted" style="margin:0">Osallistuneita: ehdotukset – ${a.voters.p1}, kategoria-äänestys – ${a.voters.p2}, ehdokkaat – ${a.voters.p3}, finaali – ${a.voters.p4}</p>
        ${s.phase <= 4 ? `<p class="small" style="margin:0">Lukinneet tässä vaiheessa: <b style="color:var(--gold-light);font-weight:500">${a.locked} / ${a.participants.length}</b></p>` : ''}
      </div>
    </div>

    ${participantsView()}

    <form class="panel" id="settings-form">
      <p class="eyebrow">Asetukset</p>
      <div class="admin-grid">
        <div class="field"><label for="s-deadline">Vaihe päättyy (näkyy kaikille)</label><input class="input" id="s-deadline" value="${esc(s.deadline)}" placeholder="pe 4.12. klo 20"></div>
        <div class="field"><label for="s-tc">Kategorioita gaalassa (sis. kiinteän)</label><input class="input" id="s-tc" type="number" min="2" max="50" value="${L.targetCategories}"><span class="small muted">→ äänestyksellä valitaan ${L.advanceCount}</span></div>
        <div class="field"><label for="s-cv">Ääniä / hlö kategoria-äänestyksessä</label><input class="input" id="s-cv" type="number" min="1" max="50" value="${L.catVotes}"></div>
        <div class="field"><label for="s-v2">Ääniä / kategoria ehdokasvaiheessa</label><input class="input" id="s-v2" type="number" min="1" max="50" value="${L.votesP2}"></div>
        <div class="field"><label for="s-mc">Kategoriaehdotuksia / hlö</label><input class="input" id="s-mc" type="number" min="1" max="50" value="${L.maxCategoryProposals}"></div>
        <div class="field"><label for="s-mn">Ehdokasehdotuksia / hlö / kategoria</label><input class="input" id="s-mn" type="number" min="1" max="50" value="${L.maxNomineeProposals}"></div>
        <div class="field"><label for="s-fi">Finalisteja / kategoria (automaattivalinta)</label><input class="input" id="s-fi" type="number" min="1" max="50" value="${L.finalists}"></div>
      </div>
      <div><button class="btn btn--secondary btn--sm" type="submit">Tallenna asetukset</button></div>
    </form>

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
        <button class="btn btn--secondary btn--sm" data-act="auto-finalists">Valitse ${L.finalists} eniten ääniä saanutta jokaiseen</button>
        ${s.phase >= 4 ? `<label class="check small"><input type="checkbox" data-act="toggle-final-counts" ${showFinalCounts ? 'checked' : ''}> Näytä finaalin äänet (spoileri)</label>` : ''}
      </div>
      ${advanced.map((c) => {
        const noms = a.nominees.filter((n) => n.categoryId === c.id).sort((x, y) => y.votes - x.votes);
        const max = Math.max(1, ...noms.map((n) => n.votes));
        const fin = noms.filter((n) => n.finalist).length;
        return `<div class="table-wrap"><table>
          <thead><tr><th colspan="${s.phase >= 4 && showFinalCounts ? 6 : 5}">${esc(c.name)} · ${fin} finalistia</th></tr></thead>
          <tbody>${noms.map((n) => `
            <tr>
              <td style="width:1%"><input type="checkbox" class="check" style="width:18px;height:18px;accent-color:var(--gold)" data-act="finalist" data-id="${n.id}" ${n.finalist ? 'checked' : ''} aria-label="Finalisti: ${esc(n.name)}"></td>
              <td>${isEditing('nom', n.id, true) ? editForm('nom', n, true) : `<div class="adm-entry">${portrait(n, 'thumb')}<div><b style="font-weight:500">${esc(n.name)}</b>${n.reason ? `<div class="small muted">${esc(n.reason)}</div>` : ''}<div class="by">Ehdottaja: ${esc(n.byName || 'poistettu osallistuja')}</div>
                <div class="photo-actions">${photoButton('nom', n.id, n.ownPhoto ? 'Vaihda kortin kuva' : 'Kortin oma kuva')}${n.photo ? `<button class="btn btn--ghost" data-act="crop-open" data-target="nom" data-id="${n.id}">Rajaa ja esikatsele</button>` : ''}${n.ownPhoto ? `<button class="btn btn--ghost" data-act="photo-del" data-target="nom" data-id="${n.id}">Poista kortin kuva</button>` : ''}</div></div></div>`}</td>
              <td style="width:25%"><div class="bar"><i style="width:${(n.votes / max) * 100}%"></i></div></td>
              <td class="num">${n.votes}</td>
              ${s.phase >= 4 && showFinalCounts ? `<td class="num" style="color:var(--gold-text)">${n.finalist ? n.finalVotes + ' fin.' : ''}${n.finalVoters.length ? `<div class="voters">${esc(n.finalVoters.join(', '))}</div>` : ''}</td>` : ''}
              <td class="act">${isEditing('nom', n.id, true) ? '' : `${editButton('nom', n.id, true)}<button class="btn btn--ghost" data-act="del-nom" data-id="${n.id}" aria-label="Poista ${esc(n.name)}">Poista</button>`}</td>
            </tr>`).join('') || `<tr><td colspan="6" class="muted">Ei ehdokkaita.</td></tr>`}</tbody>
        </table></div>`;
      }).join('')}
    </div>` : ''}

    ${s.phase === 5 ? resultsView() : ''}
    ${s.phase === 5 || (a.feedbackLog || []).length ? feedbackLogView() : ''}
  </section>`;
}

function participantsView() {
  const a = state.admin; const ph = state.phase;
  const L = state.limits;
  // Käytetyt ehdotukset tai äänet tässä vaiheessa
  const status = (p) => {
    if (ph === 1) return `${p.p1} / ${L.maxCategoryProposals} ehdotusta`;
    if (ph === 2) return `${p.p2} / ${L.catVotes} ääntä`;
    if (ph === 3) return `${p.p3} / ${a.nomVoteNeed} ääntä`;
    return `${p.p4} / ${state.categories.length} ääntä`;
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
      <thead><tr><th>Nimi</th><th>Koodi</th><th>${ph >= 4 ? 'Finaali' : 'Vaihe ' + ph} · käytetty</th><th>Ehdokkaana</th><th>Admin</th><th></th></tr></thead>
      <tbody>${a.participants.map((p) => `
        <tr>
          <td><div class="adm-entry">${portrait(p, 'thumb')}<div><b style="font-weight:500">${esc(p.name)}</b>${p.joined ? '' : '<div class="small muted">Ei vielä kirjautunut</div>'}
            <div class="photo-actions">${photoButton('user', p.id, p.photo ? 'Vaihda kuva' : 'Lisää kuva')}${p.photo ? `<button class="btn btn--ghost" data-act="crop-open" data-target="user" data-id="${p.id}">Rajaa</button><button class="btn btn--ghost" data-act="photo-del" data-target="user" data-id="${p.id}">Poista kuva</button>` : ''}</div></div></div></td>
          <td><code class="code">${esc(p.code)}</code></td>
          <td class="small">${ph <= 4 ? status(p) : '–'}${p.locked && ph <= 4 ? ' <span class="tag tag--gold">Lukittu</span>' : ''}</td>
          <td class="nominable"><input type="checkbox" data-act="user-nominable" data-id="${p.id}" ${p.nominable ? 'checked' : ''} aria-label="Ehdokkaana: ${esc(p.name)}" title="Näkyykö henkilö ehdokaskorteissa"></td>
          <td><input type="checkbox" style="width:18px;height:18px;accent-color:var(--gold)" data-act="user-admin" data-id="${p.id}" ${p.admin ? 'checked' : ''} aria-label="Admin: ${esc(p.name)}"></td>
          <td class="act">
            ${p.locked && ph <= 4 ? `<button class="btn btn--ghost" data-act="user-unlock" data-id="${p.id}" data-name="${esc(p.name)}">Avaa lukko</button>` : ''}
            <button class="btn btn--ghost" data-act="copy-link" data-code="${esc(p.code)}" data-name="${esc(p.name)}">Kopioi linkki</button>
            <button class="btn btn--ghost" data-act="user-regen" data-id="${p.id}">Uusi koodi</button>
            <button class="btn btn--ghost" data-act="user-del" data-id="${p.id}">Poista</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted" style="margin:0">Linkki kirjaa kaverin sisään suoraan. "Uusi koodi" mitätöi vanhan koodin ja kirjaa kaverin ulos kaikilta laitteilta. Osallistujan kuva näkyy hänen henkilö- ja ehdokaskorteissaan; yksittäiselle ehdokaskortille voi vaihtaa oman kuvan ehdokastaulukosta.</p>` : '<div class="empty">Ei vielä osallistujia. Lisää kaverien nimet yllä, niin jokainen saa oman koodin.</div>'}
  </div>`;
}

// ---------- Palaute (suljettu vaihe) ----------
// Palaute näkyy muille ilman nimeä; järjestäjät näkevät kirjoittajan hallinnan palautelokista.
function feedbackView() {
  const list = [...(state.feedback || [])].reverse();
  return `
  <section class="section feedback">
    <form class="panel feedback-form" id="feedback-form">
      <p class="eyebrow">Anonyymi palaute</p>
      <h2 class="h2">Mitä mieltä olit?</h2>
      <p class="small muted" style="margin:0">Palaute näkyy muille ilman nimeä. Järjestäjät näkevät kirjoittajan.</p>
      <div class="field"><label for="fb-text" class="sr-only">Palaute</label><textarea class="input" id="fb-text" data-keep rows="4" maxlength="1000" placeholder="Kerro gaalasta, äänestyksestä tai mistä vain…"></textarea></div>
      <div><button class="btn btn--primary btn--sm" type="submit">Lähetä palaute</button></div>
    </form>
    <div class="feedback-list">
      ${list.length ? list.map((f) => `
      <article class="feedback-item">
        <p>${esc(f.text).replace(/\n/g, '<br>')}</p>
        <footer><span>— ${f.mine ? 'sinä (näkyy muille nimettömänä)' : 'nimetön'} · ${fmtTime(f.createdAt)}</span>${f.mine || state.me.admin ? `<button class="btn btn--ghost" data-act="fb-del" data-id="${f.id}">Poista</button>` : ''}</footer>
      </article>`).join('') : '<div class="empty">Ei vielä palautetta. Ole ensimmäinen.</div>'}
    </div>
  </section>`;
}

const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('fi-FI', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// Hallinnan palauteloki: kirjoittaja näkyy vain täällä
function feedbackLogView() {
  const log = [...(state.admin.feedbackLog || [])].reverse();
  return `
  <div style="display:grid;gap:12px">
    <p class="eyebrow">Palauteloki · ${log.length}</p>
    ${log.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Aika</th><th>Kirjoittaja</th><th>Palaute</th><th></th></tr></thead>
      <tbody>${log.map((f) => `
        <tr>
          <td class="small" style="white-space:nowrap">${fmtTime(f.createdAt)}</td>
          <td><b style="font-weight:500">${esc(f.name)}</b></td>
          <td class="fb-text">${esc(f.text).replace(/\n/g, '<br>')}</td>
          <td class="act"><button class="btn btn--ghost" data-act="fb-del" data-id="${f.id}">Poista</button></td>
        </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty">Ei vielä palautetta.</div>'}
  </div>`;
}

// ---------- Rajausikkuna (admin) ----------
// Vedä kuvaa siirtääksesi kohdistuspistettä, liukusäädin zoomaa. Esikatselu näyttää ehdokaskortin ja henkilökortin.
function openCrop(target, id) {
  const a = state.admin;
  const item = target === 'user' ? a.participants.find((p) => p.id === id) : a.nominees.find((n) => n.id === id);
  if (!item || !item.photo) return;
  cropping = { target, id, src: item.photo.src, x: item.photo.x, y: item.photo.y, z: item.photo.z, name: item.name, reason: item.reason || '' };
  render();
}

function cropView() {
  const c = cropping; const ph = { src: c.src, x: c.x, y: c.y, z: c.z };
  return `
  <div class="crop-overlay" role="dialog" aria-modal="true" aria-labelledby="crop-h">
    <div class="crop-dialog panel">
      <p class="eyebrow" id="crop-h">Rajaa kuva · ${esc(c.name)}</p>
      <p class="small muted" style="margin:0">Vedä kuvaa siirtääksesi, zoomaa liukusäätimellä. Esikatselu näyttää kortin sellaisena kuin osallistujat sen näkevät.</p>
      <div class="crop-previews">
        <article class="nom-card crop-card">
          <div class="nom-media crop-frame" data-crop-frame>${portrait({ name: c.name, photo: ph })}</div>
          <div class="nom-body"><h3 class="h3">${esc(c.name)}</h3><p>${esc(c.reason || (c.target === 'user' ? 'Ehdokaskortti' : ''))}</p></div>
          <span class="btn btn--sm btn--secondary" aria-hidden="true">Äänestä</span>
        </article>
        <div class="crop-side">
          <div class="final-card crop-final" aria-hidden="true">${portrait({ name: c.name, photo: ph }, 'final-photo')}<span class="final-body"><b>${esc(c.name)}</b></span></div>
          <div class="person-card crop-person" aria-hidden="true">${portrait({ name: c.name, photo: ph }, 'person-photo')}<span class="person-name">${esc(c.name)}</span></div>
        </div>
      </div>
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
  if (e.target.matches('[data-crop-zoom]') && cropping) { cropping.z = Number(e.target.value); applyCropPreview(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cropping) { cropping = null; render(); } });

// Kuvan valinta: tiedostokenttä napin sisällä; muutos käsitellään change-tapahtumassa
function photoButton(target, id, label) {
  return `<label class="btn btn--ghost file-btn">${label}<input type="file" accept="image/*" data-act="photo-upload" data-target="${target}" data-id="${id}"></label>`;
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
      <p class="eyebrow">Tulokset · gaalan esitystä varten</p>
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

// ---------- Tapahtumat ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const id = t.dataset.id;
  switch (t.dataset.act) {
    case 'logout': await api('POST', '/api/logout', {}); state = { ...state, me: null }; render(); break;
    case 'vote-cat': await api('POST', `/api/categories/${id}/vote`, {}).catch(() => {}); break;
    case 'vote-nom': await api('POST', `/api/nominees/${id}/vote`, {}).catch(() => {}); break;
    case 'copy-link': {
      const link = `${location.origin}/?k=${t.dataset.code}`;
      try { await navigator.clipboard.writeText(link); toast(`${t.dataset.name}: linkki kopioitu.`); }
      catch { prompt('Kopioi linkki:', link); }
      break;
    }
    case 'lock':
      if (confirm(lockWarning() + 'Lukitaanko vastauksesi? Tämän jälkeen et voi enää muuttaa tämän vaiheen valintoja.')) await api('POST', '/api/lock', {}).catch(() => {});
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
    case 'crop-open': openCrop(t.dataset.target, id); break;
    case 'crop-cancel': cropping = null; render(); break;
    case 'crop-reset': cropping.x = 50; cropping.y = 50; cropping.z = 1; applyCropPreview(); break;
    case 'crop-save': {
      const c = cropping;
      await api('POST', `/api/admin/${c.target === 'user' ? 'users' : 'nominees'}/${c.id}/crop`, { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 100) / 100 })
        .then(() => { cropping = null; render(); }).catch(() => {});
      break;
    }
    case 'fb-del':
      if (confirm('Poistetaanko palaute?')) await api('DELETE', `/api/feedback/${id}`, {}).catch(() => {});
      break;
    case 'photo-del':
      if (confirm('Poistetaanko kuva?')) await api('DELETE', `/api/admin/${t.dataset.target === 'user' ? 'users' : 'nominees'}/${id}/photo`, {}).catch(() => {});
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
  switch (t.dataset.act) {
    case 'final': await api('POST', '/api/final', { nomineeId: t.value }).then(() => toast('Ääni tallennettu.')).catch(() => {}); break;
    case 'user-nominable': await api('POST', `/api/admin/users/${t.dataset.id}`, { nominable: t.checked }).catch(() => {}); break;
    case 'user-admin': await api('POST', `/api/admin/users/${t.dataset.id}`, { admin: t.checked }).catch(() => {}); break;
    case 'advance': await api('POST', `/api/admin/categories/${t.dataset.id}`, { advanced: t.checked }).catch(() => {}); break;
    case 'finalist': await api('POST', `/api/admin/nominees/${t.dataset.id}`, { finalist: t.checked }).catch(() => {}); break;
    case 'toggle-final-counts': showFinalCounts = t.checked; render(); break;
    case 'photo-upload': {
      const file = t.files && t.files[0];
      if (!file) break;
      try {
        toast('Ladataan kuvaa…');
        const image = await imageToDataUrl(file);
        await api('POST', `/api/admin/${t.dataset.target === 'user' ? 'users' : 'nominees'}/${t.dataset.id}/photo`, { image });
        openCrop(t.dataset.target, t.dataset.id); // heti rajaukseen ja esikatseluun
      } catch (err) { if (err && err.message) toast(err.message, true); }
      break;
    }
  }
});

// Pienennä kuva selaimessa ennen lähetystä: pidempi sivu max 1400 px (riittää zoomaukseen), JPEG-laatu 0,85
async function imageToDataUrl(file, max = 1400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Kuvaa ei voitu lukea. Kokeile JPEG- tai PNG-kuvaa.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
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
      await api('POST', '/api/categories', { name: v('c-name'), description: v('c-desc') });
      clear('c-name', 'c-desc');
      toast('Kategoria ehdotettu.');
    } else if (f.dataset.form === 'nom') {
      const cid = f.dataset.cat; const reason = v('pr-' + cid);
      await api('POST', '/api/nominees', { categoryId: cid, personId: f.dataset.person, reason });
      clear('pr-' + cid);
      proposing = null; render();
      toast('Ehdokas lisätty. Muista myös äänestää.');
    } else if (f.dataset.form === 'edit') {
      const { kind, id } = f.dataset; const admin = !!f.dataset.admin; const k = `${kind}-${id}`;
      const body = kind === 'cat' ? { name: v('e1-' + k), description: v('e2-' + k) }
        : f.dataset.person ? { personId: v('e1-' + k), reason: v('e2-' + k) } : { name: v('e1-' + k), reason: v('e2-' + k) };
      const base = kind === 'cat' ? 'categories' : 'nominees';
      await api('POST', admin ? `/api/admin/${base}/${id}` : `/api/${base}/${id}/edit`, body);
      editing = null; render();
      toast('Muutokset tallennettu.');
    } else if (f.id === 'feedback-form') {
      const text = v('fb-text');
      if (!text) return;
      await api('POST', '/api/feedback', { text });
      clear('fb-text');
    } else if (f.id === 'settings-form') {
      await api('POST', '/api/admin/settings', { deadline: v('s-deadline'), targetCategories: v('s-tc'), catVotes: v('s-cv'), votesP2: v('s-v2'), maxCategoryProposals: v('s-mc'), maxNomineeProposals: v('s-mn'), finalists: v('s-fi') });
      toast('Asetukset tallennettu.');
    }
  } catch { /* virhe näytetty toastina */ }
});


// Päivitä tila taustalla (ei kun käyttäjä kirjoittaa)
setInterval(() => {
  if (document.hidden || cropping) return;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio') return;
  (async () => {
  const k = new URLSearchParams(location.search).get('k');
  if (k) {
    history.replaceState(null, '', location.pathname);
    try { await api('POST', '/api/login', { code: k }); return; } catch {}
  }
  refresh();
})();
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

(async () => {
  const k = new URLSearchParams(location.search).get('k');
  if (k) {
    history.replaceState(null, '', location.pathname);
    try { await api('POST', '/api/login', { code: k }); return; } catch {}
  }
  refresh();
})();
