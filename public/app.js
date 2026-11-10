'use strict';
/* Default Settings Gaala – käyttöliittymä (ei riippuvuuksia) */

let state = null;
let showFinalCounts = false;

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
          <p class="lead">Ensin päätetään kategoriat, sitten ehdokkaat ja lopuksi voittajat. Äänet ovat anonyymejä, ja voittajat paljastetaan gaalassa.</p>
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
      ${phaseHero()}
    </section>
    ${s.me.root ? `<div class="panel"><p class="eyebrow">Ylläpitotunnus</p><p style="margin:0">Tällä tunnuksella hallinnoidaan, mutta ei äänestetä. Lisää itsesi osallistujaksi alta, anna itsellesi admin-oikeus ja kirjaudu omalla koodillasi.</p></div>` : phaseBody()}
    ${s.me.admin ? adminView() : ''}
    <footer class="footer">
      <span>Default Settings Gaala</span>
    </footer>
  </main>`;
}

function stepper() {
  const names = ['Kategoriat', 'Ehdokkaat', 'Finaali', 'Suljettu'];
  return `<ol class="stepper">${names.map((n, i) => {
    const p = i + 1; const cls = p < state.phase ? 'done' : p === state.phase ? 'now' : '';
    return `<li class="${cls}" ${p === state.phase ? 'aria-current="step"' : ''}>${p < 4 ? 'Vaihe ' + p : 'Lopuksi'}<b>${n}</b></li>`;
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
      <p class="eyebrow">Vaihe 1 / 3 · Kategoriat</p>
      <h1 class="h1">Mistä palkintoja jaetaan?</h1>
      <p class="lead">Gaalassa jaetaan ${L.targetCategories} palkintoa. ”Vuoden sykähdyttävin hetki” on mukana joka tapauksessa, joten loput ${L.votesP1} valitaan äänestämällä. Sinulla on ${L.votesP1} ääntä, enintään yksi per kategoria.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(s.used.catVotes, L.votesP1)} Ääniä käytetty ${s.used.catVotes} / ${L.votesP1}</span>${deadline()}</div>`;
  }
  if (s.phase === 2) {
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 2 / 3 · Ehdokkaat</p>
      <h1 class="h1">Keitä palkitaan?</h1>
      <p class="lead">Kategoriat on valittu. Sinulla on ${L.votesP2} ääntä jokaisessa kategoriassa. Kun ehdotat jotakuta, yksi äänesi menee ehdotukselle automaattisesti – voit siirtää sen myöhemmin. Saman henkilön voi ehdottaa useammasta eri aiheesta.</p>
    </div>
    <div class="meta-row">${deadline()}</div>`;
  }
  if (s.phase === 3) {
    const cats = s.categories; const done = cats.filter((c) => s.nominees.some((n) => n.categoryId === c.id && n.myFinal)).length;
    return `<div class="hero-head">
      <p class="eyebrow">Vaihe 3 / 3 · Finaali</p>
      <h1 class="h1">Valitse voittajat</h1>
      <p class="lead">Yksi ääni per kategoria. Voit vaihtaa valintaasi niin kauan kuin äänestys on auki.</p>
    </div>
    <div class="meta-row"><span class="meter">${pips(done, cats.length)} Äänestetty ${done} / ${cats.length} kategoriaa</span>${deadline()}</div>`;
  }
  return `<div class="hero-head">
    <p class="eyebrow">Äänestys päättyi</p>
    <h1 class="display">Äänestys on suljettu</h1>
    <p class="lead">Kiitos äänistä! Voittajat julkistetaan gaalassa.</p>
  </div>`;
}

function phaseBody() {
  if (state.phase === 1) return phase1();
  if (state.phase === 2) return phase2();
  if (state.phase === 3) return phase3();
  return phase4();
}

function phase1() {
  const s = state; const L = s.limits;
  const left = L.maxCategoryProposals - s.used.catProposals;
  const cats = [...s.categories].sort((a, b) => (b.fixed - a.fixed) || a.name.localeCompare(b.name, 'fi'));
  const full = s.used.catVotes >= L.votesP1;
  return `
  <section class="section">
    <form class="panel" id="cat-form">
      <div class="cat-head" style="border:0;padding:0"><p class="eyebrow">Uusi kategoria</p><p class="small muted" style="margin:0">Ehdotuksia jäljellä ${Math.max(0, left)} / ${L.maxCategoryProposals}. Ehdottajan nimi ei näy muille.</p></div>
      <div class="form-row">
        <div class="field"><label for="c-name">Nimi</label><input class="input" id="c-name" data-keep maxlength="60" required placeholder="Esim. Vuoden myöhästyjä" ${left <= 0 ? 'disabled' : ''}></div>
        <div class="field"><label for="c-desc">Kuvaus (valinnainen)</label><input class="input" id="c-desc" data-keep maxlength="160" placeholder="Mistä palkinto annetaan?" ${left <= 0 ? 'disabled' : ''}></div>
        <button class="btn btn--primary" type="submit" ${left <= 0 ? 'disabled' : ''}>${left <= 0 ? 'Ehdotukset käytetty' : 'Ehdota'}</button>
      </div>
    </form>
    <div class="list">
      ${cats.map((c) => `
      <div class="item ${c.myVote ? 'is-voted' : ''}">
        <div>
          <div class="title">${esc(c.name)} ${c.fixed ? '<span class="tag tag--gold">Mukana aina</span>' : ''} ${c.mine ? '<span class="tag">Sinun ehdotuksesi</span>' : ''}</div>
          ${c.description ? `<p>${esc(c.description)}</p>` : ''}
        </div>
        ${c.fixed ? '' : `<button class="btn btn--sm ${c.myVote ? 'btn--voted' : 'btn--secondary'}" data-act="vote-cat" data-id="${c.id}" aria-pressed="${c.myVote}" ${!c.myVote && full ? 'disabled title="Kaikki äänet käytetty"' : ''}>${c.myVote ? 'Äänestetty' : 'Äänestä'}</button>`}
      </div>`).join('')}
      ${cats.length <= 1 ? '<div class="empty">Ei vielä muita ehdotuksia. Ehdota ensimmäinen kategoria yllä.</div>' : ''}
    </div>
  </section>`;
}

function initial(name) {
  const ch = [...String(name).trim()][0] || '?';
  return ch.toLocaleUpperCase('fi');
}

function phase2() {
  const s = state; const L = s.limits;
  return s.categories.map((c, idx) => {
    const noms = s.nominees.filter((n) => n.categoryId === c.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'fi') || a.reason.localeCompare(b.reason, 'fi'));
    const used = noms.filter((n) => n.myVote).length;
    const full = used >= L.votesP2;
    return `
    <section class="section" id="cat-${c.id}">
      <header class="cat-head">
        <p class="eyebrow">Kategoria ${String(idx + 1).padStart(2, '0')}</p>
        <div class="row"><h2 class="h2">${esc(c.name)}</h2><span class="meter small">${pips(used, L.votesP2)} Ääniä käytetty ${used} / ${L.votesP2}</span></div>
        ${c.description ? `<p class="muted" style="margin:0">${esc(c.description)}</p>` : ''}
      </header>
      ${noms.length ? `<div class="nom-grid">
        ${noms.map((n) => `
        <article class="nom-card ${n.myVote ? 'is-voted' : ''}">
          <div class="nom-mono" aria-hidden="true"><span>${esc(initial(n.name))}</span>${n.mine ? '<span class="tag nom-tag">Sinun ehdotuksesi</span>' : ''}</div>
          <div class="nom-body">
            <h3 class="h3">${esc(n.name)}</h3>
            <p>${esc(n.reason)}</p>
          </div>
          <button class="btn btn--sm ${n.myVote ? 'btn--voted' : 'btn--secondary'}" data-act="vote-nom" data-id="${n.id}" aria-pressed="${n.myVote}" ${!n.myVote && full ? 'disabled title="Kategorian äänet käytetty"' : ''}>${n.myVote ? 'Äänestetty' : 'Äänestä'}</button>
        </article>`).join('')}
      </div>` : '<div class="empty">Ei vielä ehdokkaita. Ehdota ensimmäinen alla.</div>'}
      <form class="panel" data-form="nom" data-cat="${c.id}">
        <p class="eyebrow">Uusi ehdotus</p>
        <div class="form-row">
          <div class="field"><label for="nn-${c.id}">Ehdokas</label><input class="input" id="nn-${c.id}" data-keep maxlength="60" required placeholder="Kuka?" ${full ? 'disabled' : ''}></div>
          <div class="field"><label for="nr-${c.id}">Mistä?</label><input class="input" id="nr-${c.id}" data-keep maxlength="160" required minlength="3" placeholder="Mikä hetki tai teko?" ${full ? 'disabled' : ''}></div>
          <button class="btn btn--primary" type="submit" ${full ? 'disabled' : ''}>Ehdota</button>
        </div>
        <p class="small muted" style="margin:0">${full ? 'Kaikki äänesi tässä kategoriassa on käytetty. Poista ääni joltain ehdokkaalta, niin voit ehdottaa uutta.' : 'Ehdotus vie yhden äänesi tässä kategoriassa.'}</p>
      </form>
    </section>`;
  }).join('');
}

function phase3() {
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
      <div class="list" role="radiogroup" aria-label="${esc(c.name)}">
        ${noms.map((n) => `
        <label class="vote"><input type="radio" name="f-${c.id}" value="${n.id}" data-act="final" ${n.myFinal ? 'checked' : ''}>
          <span class="txt"><b>${esc(n.name)}</b>${n.reason ? `<span>${esc(n.reason)}</span>` : ''}</span></label>`).join('')}
      </div>
    </section>`;
  }).join('');
}

function phase4() { return ''; }

// ---------- Admin ----------
function adminView() {
  const s = state; const a = s.admin; const L = s.limits;
  const maxCat = Math.max(1, ...a.categories.map((c) => c.votes));
  const advanced = a.categories.filter((c) => c.advanced);
  const phaseNames = { 1: 'Kategoriat', 2: 'Ehdokkaat', 3: 'Finaali', 4: 'Suljettu' };
  return `
  <section class="admin" aria-labelledby="admin-h">
    <header class="cat-head"><p class="eyebrow">Vain järjestäjille</p><h2 class="h2" id="admin-h">Hallinta</h2></header>

    <div class="admin-grid">
      <div class="panel">
        <p class="eyebrow">Vaihe</p>
        <p style="margin:0">Nyt: <b>${s.phase}. ${phaseNames[s.phase]}</b></p>
        <div class="phase-btns">${[1, 2, 3, 4].filter((p) => p !== s.phase).map((p) => `<button class="btn btn--sm ${p === s.phase + 1 ? 'btn--primary' : 'btn--secondary'}" data-act="phase" data-phase="${p}">${p > s.phase ? 'Siirry' : 'Palaa'}: ${phaseNames[p]}</button>`).join('')}</div>
      </div>
      <div class="panel">
        <p class="eyebrow">Osallistujat</p>
        <p style="margin:0" class="h3">${a.participants.length} koodia · ${a.participants.filter((p) => p.joined).length} kirjautunut</p>
        <p class="small muted" style="margin:0">Äänestäneitä: vaihe 1 – ${a.voters.p1}, vaihe 2 – ${a.voters.p2}, finaali – ${a.voters.p3}</p>
      </div>
    </div>

    ${participantsView()}

    <form class="panel" id="settings-form">
      <p class="eyebrow">Asetukset</p>
      <div class="admin-grid">
        <div class="field"><label for="s-deadline">Vaihe päättyy (näkyy kaikille)</label><input class="input" id="s-deadline" value="${esc(s.deadline)}" placeholder="pe 4.12. klo 20"></div>
        <div class="field"><label for="s-tc">Kategorioita gaalassa (sis. kiinteän)</label><input class="input" id="s-tc" type="number" min="2" max="50" value="${L.targetCategories}"><span class="small muted">→ ${L.votesP1} ääntä vaiheessa 1</span></div>
        <div class="field"><label for="s-v2">Ääniä / kategoria vaiheessa 2</label><input class="input" id="s-v2" type="number" min="1" max="50" value="${L.votesP2}"></div>
        <div class="field"><label for="s-mc">Kategoriaehdotuksia / hlö</label><input class="input" id="s-mc" type="number" min="1" max="50" value="${L.maxCategoryProposals}"></div>
        <div class="field"><label for="s-mn">Ehdokasehdotuksia / hlö / kategoria</label><input class="input" id="s-mn" type="number" min="1" max="50" value="${L.maxNomineeProposals}"></div>
      </div>
      <div><button class="btn btn--secondary btn--sm" type="submit">Tallenna asetukset</button></div>
    </form>

    <div style="display:grid;gap:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <p class="eyebrow">Kategoriat · jatkoon ${advanced.length} / ${L.targetCategories}</p>
        <button class="btn btn--secondary btn--sm" data-act="auto-advance">Valitse ${L.votesP1} eniten ääniä saanutta</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Jatkoon</th><th>Kategoria</th><th>Äänet</th><th></th><th></th></tr></thead>
        <tbody>${[...a.categories].sort((x, y) => (y.fixed - x.fixed) || (y.votes - x.votes)).map((c) => `
          <tr>
            <td><label class="check"><input type="checkbox" data-act="advance" data-id="${c.id}" ${c.advanced ? 'checked' : ''} ${c.fixed ? 'disabled' : ''}><span class="small muted">${c.fixed ? 'aina' : ''}</span></label></td>
            <td><b style="font-weight:500">${esc(c.name)}</b>${c.description ? `<div class="small muted">${esc(c.description)}</div>` : ''}</td>
            <td style="width:30%">${c.fixed ? '<span class="small muted">kiinteä</span>' : `<div class="bar"><i style="width:${(c.votes / maxCat) * 100}%"></i></div>`}</td>
            <td class="num">${c.fixed ? '' : c.votes}</td>
            <td class="act">${c.fixed ? '' : `<button class="btn btn--ghost" data-act="del-cat" data-id="${c.id}" aria-label="Poista ${esc(c.name)}">Poista</button>`}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>

    ${s.phase >= 2 ? `
    <div style="display:grid;gap:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <p class="eyebrow">Ehdokkaat · valitse finalistit</p>
        ${s.phase >= 3 ? `<label class="check small"><input type="checkbox" data-act="toggle-final-counts" ${showFinalCounts ? 'checked' : ''}> Näytä finaalin äänet (spoileri)</label>` : ''}
      </div>
      ${advanced.map((c) => {
        const noms = a.nominees.filter((n) => n.categoryId === c.id).sort((x, y) => y.votes - x.votes);
        const max = Math.max(1, ...noms.map((n) => n.votes));
        const fin = noms.filter((n) => n.finalist).length;
        return `<div class="table-wrap"><table>
          <thead><tr><th colspan="${s.phase >= 3 && showFinalCounts ? 6 : 5}">${esc(c.name)} · ${fin} finalistia</th></tr></thead>
          <tbody>${noms.map((n) => `
            <tr>
              <td style="width:1%"><input type="checkbox" class="check" style="width:18px;height:18px;accent-color:var(--gold)" data-act="finalist" data-id="${n.id}" ${n.finalist ? 'checked' : ''} aria-label="Finalisti: ${esc(n.name)}"></td>
              <td><b style="font-weight:500">${esc(n.name)}</b>${n.reason ? `<div class="small muted">${esc(n.reason)}</div>` : ''}</td>
              <td style="width:25%"><div class="bar"><i style="width:${(n.votes / max) * 100}%"></i></div></td>
              <td class="num">${n.votes}</td>
              ${s.phase >= 3 && showFinalCounts ? `<td class="num" style="color:var(--gold-text)">${n.finalist ? n.finalVotes + ' fin.' : ''}</td>` : ''}
              <td class="act"><button class="btn btn--ghost" data-act="del-nom" data-id="${n.id}" aria-label="Poista ${esc(n.name)}">Poista</button></td>
            </tr>`).join('') || `<tr><td colspan="6" class="muted">Ei ehdokkaita.</td></tr>`}</tbody>
        </table></div>`;
      }).join('')}
    </div>` : ''}

    ${s.phase === 4 ? resultsView() : ''}
  </section>`;
}

function participantsView() {
  const a = state.admin; const ph = state.phase;
  const status = (p) => {
    if (ph === 1) return p.p1 ? 'Äänestänyt' : '–';
    if (ph === 2) return p.p2 ? 'Äänestänyt' : '–';
    if (ph >= 3) return `${p.p3} / ${state.categories.length}`;
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
      <thead><tr><th>Nimi</th><th>Koodi</th><th>${ph >= 3 ? 'Finaali' : 'Vaihe ' + Math.min(ph, 3)}</th><th>Admin</th><th></th></tr></thead>
      <tbody>${a.participants.map((p) => `
        <tr>
          <td><b style="font-weight:500">${esc(p.name)}</b>${p.joined ? '' : '<div class="small muted">Ei vielä kirjautunut</div>'}</td>
          <td><code class="code">${esc(p.code)}</code></td>
          <td class="small">${status(p)}</td>
          <td><input type="checkbox" style="width:18px;height:18px;accent-color:var(--gold)" data-act="user-admin" data-id="${p.id}" ${p.admin ? 'checked' : ''} aria-label="Admin: ${esc(p.name)}"></td>
          <td class="act">
            <button class="btn btn--ghost" data-act="copy-link" data-code="${esc(p.code)}" data-name="${esc(p.name)}">Kopioi linkki</button>
            <button class="btn btn--ghost" data-act="user-regen" data-id="${p.id}">Uusi koodi</button>
            <button class="btn btn--ghost" data-act="user-del" data-id="${p.id}">Poista</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted" style="margin:0">Linkki kirjaa kaverin sisään suoraan. "Uusi koodi" mitätöi vanhan koodin ja kirjaa kaverin ulos kaikilta laitteilta.</p>` : '<div class="empty">Ei vielä osallistujia. Lisää kaverien nimet yllä, niin jokainen saa oman koodin.</div>'}
  </div>`;
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
          <td><b style="font-weight:500">${esc(n.name)}</b> ${winners.includes(n.id) ? '<span class="tag tag--red">Voittaja</span>' : ''}${n.reason ? `<div class="small muted">${esc(n.reason)}</div>` : ''}</td>
          <td class="num">${n.finalVotes} ${n.finalVotes === 1 ? 'ääni' : 'ääntä'}</td>
        </tr>`).join('') || '<tr><td class="muted">Ei finalisteja.</td></tr>'}</tbody>
    </table></div>`).join('')}
  </div>`;
}

function resultsText() {
  return results().map(({ cat, noms, winners }) => {
    const lines = noms.map((n) => `${winners.includes(n.id) ? '★ ' : '  '}${n.name}${n.reason ? ' – ' + n.reason : ''} (${n.finalVotes})`);
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
    case 'user-admin': await api('POST', `/api/admin/users/${t.dataset.id}`, { admin: t.checked }).catch(() => {}); break;
    case 'advance': await api('POST', `/api/admin/categories/${t.dataset.id}`, { advanced: t.checked }).catch(() => {}); break;
    case 'finalist': await api('POST', `/api/admin/nominees/${t.dataset.id}`, { finalist: t.checked }).catch(() => {}); break;
    case 'toggle-final-counts': showFinalCounts = t.checked; render(); break;
  }
});

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
      const cid = f.dataset.cat;
      // tyhjennä ennen renderöintiä, ettei render palauta tekstiä
      const name = v('nn-' + cid), reason = v('nr-' + cid);
      clear('nn-' + cid, 'nr-' + cid);
      await api('POST', '/api/nominees', { categoryId: cid, name, reason }).catch((err) => {
        const n = document.getElementById('nn-' + cid), r = document.getElementById('nr-' + cid);
        if (n) n.value = name; if (r) r.value = reason; throw err;
      });
      toast('Ehdokas lisätty.');
    } else if (f.id === 'settings-form') {
      await api('POST', '/api/admin/settings', { deadline: v('s-deadline'), targetCategories: v('s-tc'), votesP2: v('s-v2'), maxCategoryProposals: v('s-mc'), maxNomineeProposals: v('s-mn') });
      toast('Asetukset tallennettu.');
    }
  } catch { /* virhe näytetty toastina */ }
});


// Päivitä tila taustalla (ei kun käyttäjä kirjoittaa)
setInterval(() => {
  if (document.hidden) return;
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
