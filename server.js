// Default Settings Gaala – äänestyspalvelin
// Ei riippuvuuksia: Node.js 18+ riittää. Data tallentuu tiedostoon data/db.json.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------- Asetukset ----------
loadDotEnv(path.join(__dirname, '.env'));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_CODE = process.env.ADMIN_CODE || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!ADMIN_CODE || ADMIN_CODE.length < 8) {
  console.error('Aseta ADMIN_CODE, vähintään 8 merkkiä (.env-tiedostoon tai ympäristömuuttujiin).');
  process.exit(1);
}

const FIXED_CATEGORY = { name: 'Vuoden sykähdyttävin hetki', description: 'Hetki, joka jäi kaikkien mieleen.' };
// Vaiheet: 1 = kategorioiden ehdottaminen, 2 = äänestys gaalaan pääsevistä kategorioista,
// 3 = ehdokkaiden ehdottaminen ja äänestys, 4 = finaali, 5 = suljettu
const PHASES = { 1: 'Kategoriaehdotukset', 2: 'Kategoria-äänestys', 3: 'Ehdokkaat', 4: 'Finaali', 5: 'Suljettu' };

// ---------- Tietokanta (JSON-tiedosto) ----------
let db = loadDb();

function emptyDb() {
  const fixedId = newId();
  return {
    settings: {
      phase: 1,
      deadline: '',
      targetCategories: 8, // kategorioita gaalassa (sis. kiinteät); äänestyksellä valitaan tämä − kiinteät
      catVotes: 3, // ääniä per henkilö kategoria-äänestyksessä (vaihe 2)
      votesP2: 2, // ääniä per kategoria ehdokasvaiheessa (vaihe 3; oma ehdotus vie yhden)
      maxCategoryProposals: 3, // kategoriaehdotuksia per henkilö
      maxNomineeProposals: 3, // ehdokasehdotuksia per henkilö per kategoria
      phaseScheme: 2, // vaiheiden numerointi (2 = viisi vaihetta)
    },
    users: {},
    categories: [{ id: fixedId, name: FIXED_CATEGORY.name, description: FIXED_CATEGORY.description, fixed: true, advanced: true, by: null, createdAt: now() }],
    catVotes: [],
    nominees: [],
    nomVotes: [],
    finalVotes: {},
  };
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const fresh = emptyDb();
    writeDb(fresh);
    return fresh;
  }
  const data = Object.assign(emptyDb(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  const st = data.settings;
  if (st.targetCategories == null) st.targetCategories = (st.votesP1 || 7) + 1;
  delete st.votesP1;
  if (st.catVotes == null) st.catVotes = 3;
  // Vanha 4-vaiheinen versio (1 kategoriat, 2 ehdokkaat, 3 finaali, 4 suljettu) → uudet numerot.
  // Vanha vaihe 1 (ehdotukset + äänet samassa) pysyy vaiheena 1; muut siirtyvät yhdellä eteenpäin.
  if (!st.phaseScheme) {
    if (st.phase >= 2) st.phase += 1;
    st.phaseScheme = 2;
  }
  return data;
}

function writeDb(data = db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- Apufunktiot ----------
function now() { return new Date().toISOString(); }
function newId() { return crypto.randomBytes(8).toString('hex'); }
// Henkilökohtaiset koodit: 8 merkkiä ilman sekoittuvia kirjaimia (0/O, 1/I/L), muoto XXXX-XXXX
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do {
    c = Array.from(crypto.randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  } while (Object.values(db.users).some((u) => u.code === c));
  return c;
}
const normCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtCode = (c) => c ? c.slice(0, 4) + '-' + c.slice(4) : '';
const newToken = () => crypto.randomBytes(24).toString('hex');

// Kirjautumisyritysten rajoitus (estää koodien arvailun)
const attempts = new Map();
function checkRate(ip) {
  const t = Date.now(); const a = (attempts.get(ip) || []).filter((x) => t - x < 10 * 60 * 1000);
  attempts.set(ip, a);
  if (a.length >= 10) fail(429, 'Liian monta väärää koodia. Odota hetki ja yritä uudelleen.');
}
const noteFail = (ip) => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function clean(s, max) { return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function norm(s) { return clean(s, 200).toLocaleLowerCase('fi'); }

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).gaala;
  if (!token) return null;
  return Object.values(db.users).find((u) => u.token && safeEqual(u.token, token)) || null;
}

function setSession(res, token) {
  res.setHeader('Set-Cookie', `gaala=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 180}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 20000) { reject(new HttpError(413, 'Liian suuri pyyntö')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Virheellinen JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ---------- Näkymä käyttäjälle ----------
const fixedCount = () => db.categories.filter((c) => c.fixed).length;
// Äänestyksellä valittavien kategorioiden määrä = gaalan kategoriat ilman kiinteitä (ne ovat mukana joka tapauksessa)
const advanceCount = () => Math.max(1, db.settings.targetCategories - fixedCount());

const advancedCats = () => db.categories.filter((c) => c.advanced);

function stateFor(user) {
  const s = db.settings;
  const base = {
    phase: s.phase,
    phaseName: PHASES[s.phase],
    deadline: s.deadline,
    limits: { targetCategories: s.targetCategories, fixedCategories: fixedCount(), advanceCount: advanceCount(), catVotes: s.catVotes, votesP2: s.votesP2, maxCategoryProposals: s.maxCategoryProposals, maxNomineeProposals: s.maxNomineeProposals },
    me: user ? { name: user.name, admin: !!user.admin, root: !!user.root, locked: isLocked(user) } : null,
  };
  if (!user) return base;
  const uid = user.id;

  const myCatVotes = new Set(db.catVotes.filter((v) => v.userId === uid).map((v) => v.categoryId));
  const myNomVotes = new Set(db.nomVotes.filter((v) => v.userId === uid).map((v) => v.nomineeId));
  const myFinal = db.finalVotes[uid] || {};

  const visibleCats = s.phase <= 2 ? db.categories : advancedCats();
  base.categories = visibleCats.map((c) => ({
    id: c.id, name: c.name, description: c.description, fixed: !!c.fixed, advanced: !!c.advanced,
    mine: c.by === uid, myVote: myCatVotes.has(c.id),
  }));

  const visibleNoms = s.phase === 3
    ? db.nominees.filter((n) => advancedCats().some((c) => c.id === n.categoryId))
    : s.phase >= 4 ? db.nominees.filter((n) => n.finalist) : [];
  base.nominees = visibleNoms.map((n) => ({
    id: n.id, categoryId: n.categoryId, name: n.name, reason: n.reason, finalist: !!n.finalist,
    mine: n.by === uid, myVote: myNomVotes.has(n.id), myFinal: myFinal[n.categoryId] === n.id,
  }));

  base.used = {
    catVotes: myCatVotes.size,
    catProposals: db.categories.filter((c) => c.by === uid).length,
  };


  if (user.admin) base.admin = adminView();
  return base;
}

function countBy(list, key) {
  const m = {}; for (const v of list) m[v[key]] = (m[v[key]] || 0) + 1; return m;
}

function finalCounts() {
  const m = {};
  for (const votes of Object.values(db.finalVotes)) for (const nomineeId of Object.values(votes)) m[nomineeId] = (m[nomineeId] || 0) + 1;
  return m;
}

function winnersFor(categoryIds) {
  const counts = finalCounts();
  const out = {};
  for (const cid of categoryIds) {
    const fins = db.nominees.filter((n) => n.categoryId === cid && n.finalist);
    const max = Math.max(0, ...fins.map((n) => counts[n.id] || 0));
    out[cid] = max === 0 ? [] : fins.filter((n) => (counts[n.id] || 0) === max).map((n) => n.id);
  }
  return out;
}

function adminView() {
  const catCounts = countBy(db.catVotes, 'categoryId');
  const nomCounts = countBy(db.nomVotes, 'nomineeId');
  const fin = finalCounts();
  return {
    participants: Object.values(db.users).filter((u) => !u.root).map((u) => ({
      id: u.id, name: u.name, code: fmtCode(u.code), admin: !!u.admin, joined: !!u.lastLogin,
      p1: db.categories.filter((c) => c.by === u.id).length,
      p2: db.catVotes.some((v) => v.userId === u.id),
      p3: db.nomVotes.some((v) => v.userId === u.id),
      p4: Object.keys(db.finalVotes[u.id] || {}).length,
      locked: isLocked(u),
    })).sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    categories: db.categories.map((c) => ({ id: c.id, name: c.name, description: c.description, fixed: !!c.fixed, advanced: !!c.advanced, votes: catCounts[c.id] || 0 })),
    nominees: db.nominees.map((n) => ({ id: n.id, categoryId: n.categoryId, name: n.name, reason: n.reason, finalist: !!n.finalist, votes: nomCounts[n.id] || 0, finalVotes: fin[n.id] || 0 })),
    voters: { p1: new Set(db.categories.filter((c) => c.by).map((c) => c.by)).size, p2: new Set(db.catVotes.map((v) => v.userId)).size, p3: new Set(db.nomVotes.map((v) => v.userId)).size, p4: Object.keys(db.finalVotes).length },
    locked: Object.values(db.users).filter((u) => !u.root && isLocked(u)).length,
    winners: winnersFor(advancedCats().map((c) => c.id)),
  };
}

// ---------- Reitit ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

route('GET', '/api/state', ({ user }) => stateFor(user), { auth: false });

route('POST', '/api/login', ({ req, body, res }) => {
  // Tailscale serve välittää pyynnöt localhostista; oikea osoite on X-Forwarded-For-otsakkeessa
  const remote = req.socket.remoteAddress || '';
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  // Luotetaan otsakkeeseen, kun pyyntö tulee koneen sisältä (localhost tai Dockerin sisäverkko)
  const local = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$|^f[cd]/.test(remote);
  const ip = local && fwd ? fwd : remote;
  checkRate(ip);
  const code = normCode(body.code);
  let user;
  if (safeEqual(code, normCode(ADMIN_CODE))) {
    // Ylläpitotunnus: hallinnoi, mutta ei äänestä
    user = Object.values(db.users).find((u) => u.root);
    if (!user) { user = { id: newId(), name: 'Ylläpito', root: true, admin: true, code: null, token: newToken(), createdAt: now() }; db.users[user.id] = user; }
  } else {
    user = code.length === 8 && Object.values(db.users).find((u) => u.code && safeEqual(u.code, code));
  }
  if (!user) { noteFail(ip); fail(403, 'Koodia ei tunnistettu. Tarkista se järjestäjiltä.'); }
  user.lastLogin = now();
  writeDb();
  setSession(res, user.token);
  return stateFor(user);
}, { auth: false });

route('POST', '/api/logout', ({ res }) => {
  res.setHeader('Set-Cookie', 'gaala=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
}, { auth: false });

// Vaihe 1: kategorioiden ehdottaminen (ei ääniä; enintään maxCategoryProposals per henkilö)
route('POST', '/api/categories', ({ user, body }) => {
  requirePhase(1);
  requireVoter(user);
  requireUnlocked(user);
  const name = clean(body.name, 60);
  const description = clean(body.description, 160);
  if (name.length < 3) fail(400, 'Kategorian nimi on liian lyhyt.');
  if (db.categories.some((c) => norm(c.name) === norm(name))) fail(409, 'Tämä kategoria on jo ehdolla.');
  const mine = db.categories.filter((c) => c.by === user.id).length;
  if (mine >= db.settings.maxCategoryProposals) fail(400, `Voit ehdottaa enintään ${db.settings.maxCategoryProposals} kategoriaa.`);
  db.categories.push({ id: newId(), name, description, fixed: false, advanced: false, by: user.id, createdAt: now() });
  writeDb();
  return stateFor(user);
});

// Vaihe 2: äänestys gaalaan pääsevistä kategorioista (catVotes ääntä per henkilö)
route('POST', '/api/categories/:id/vote', ({ user, params }) => {
  requirePhase(2);
  requireVoter(user);
  requireUnlocked(user);
  const cat = db.categories.find((c) => c.id === params.id) || fail(404, 'Kategoriaa ei löydy.');
  if (cat.fixed) fail(400, 'Tämä kategoria on mukana joka tapauksessa.');
  const i = db.catVotes.findIndex((v) => v.userId === user.id && v.categoryId === cat.id);
  if (i >= 0) db.catVotes.splice(i, 1);
  else {
    const used = db.catVotes.filter((v) => v.userId === user.id).length;
    if (used >= db.settings.catVotes) fail(400, `Olet käyttänyt kaikki ${db.settings.catVotes} ääntäsi. Poista ääni toisesta kategoriasta ensin.`);
    db.catVotes.push({ userId: user.id, categoryId: cat.id });
  }
  writeDb();
  return stateFor(user);
});

// Vaihe 3: ehdokkaat
route('POST', '/api/nominees', ({ user, body }) => {
  requirePhase(3);
  requireVoter(user);
  requireUnlocked(user);
  const cat = advancedCats().find((c) => c.id === body.categoryId) || fail(404, 'Kategoriaa ei löydy.');
  const name = clean(body.name, 60);
  const reason = clean(body.reason, 160);
  if (name.length < 2) fail(400, 'Kirjoita ehdokkaan nimi.');
  if (reason.length < 3) fail(400, 'Kirjoita myös mistä ehdotat – sama henkilö voi olla ehdolla useammasta aiheesta.');
  if (db.nominees.some((n) => n.categoryId === cat.id && norm(n.name) === norm(name) && norm(n.reason) === norm(reason))) fail(409, 'Sama ehdotus on jo listalla – äänestä sitä.');
  const mine = db.nominees.filter((n) => n.categoryId === cat.id && n.by === user.id).length;
  if (mine >= db.settings.maxNomineeProposals) fail(400, `Voit ehdottaa enintään ${db.settings.maxNomineeProposals} ehdokasta per kategoria.`);
  // Ehdotus vie automaattisesti yhden äänen, joten vapaa ääni tarvitaan
  const inCat = new Set(db.nominees.filter((n) => n.categoryId === cat.id).map((n) => n.id));
  const used = db.nomVotes.filter((v) => v.userId === user.id && inCat.has(v.nomineeId)).length;
  if (used >= db.settings.votesP2) fail(400, `Ehdotus vie yhden äänesi, mutta olet jo käyttänyt kaikki ${db.settings.votesP2} ääntä tässä kategoriassa. Poista ensin ääni joltain toiselta.`);
  const nom = { id: newId(), categoryId: cat.id, name, reason, finalist: false, by: user.id, createdAt: now() };
  db.nominees.push(nom);
  db.nomVotes.push({ userId: user.id, nomineeId: nom.id });
  writeDb();
  return stateFor(user);
});

route('POST', '/api/nominees/:id/vote', ({ user, params }) => {
  requirePhase(3);
  requireVoter(user);
  requireUnlocked(user);
  const nom = db.nominees.find((n) => n.id === params.id) || fail(404, 'Ehdokasta ei löydy.');
  const i = db.nomVotes.findIndex((v) => v.userId === user.id && v.nomineeId === nom.id);
  if (i >= 0) db.nomVotes.splice(i, 1);
  else {
    const inCat = new Set(db.nominees.filter((n) => n.categoryId === nom.categoryId).map((n) => n.id));
    const used = db.nomVotes.filter((v) => v.userId === user.id && inCat.has(v.nomineeId)).length;
    if (used >= db.settings.votesP2) fail(400, `Sinulla on ${db.settings.votesP2} ääntä per kategoria. Poista ääni ensin toiselta ehdokkaalta.`);
    db.nomVotes.push({ userId: user.id, nomineeId: nom.id });
  }
  writeDb();
  return stateFor(user);
});

// Vaihe 4: finaali
route('POST', '/api/final', ({ user, body }) => {
  requirePhase(4);
  requireVoter(user);
  requireUnlocked(user);
  const nom = db.nominees.find((n) => n.id === body.nomineeId && n.finalist) || fail(404, 'Finalistia ei löydy.');
  db.finalVotes[user.id] = { ...(db.finalVotes[user.id] || {}), [nom.categoryId]: nom.id };
  writeDb();
  return stateFor(user);
});

// Vastausten lukitus ("Lukko sisään"): vahvistaa, että osallistuja on valmis tämän vaiheen kanssa.
// Lukituksen jälkeen vaiheen ääniä ja ehdotuksia ei voi muuttaa; järjestäjä voi avata lukon hallinnasta.
route('POST', '/api/lock', ({ user }) => {
  requireVoter(user);
  if (db.settings.phase > 4) fail(409, 'Äänestys on jo suljettu.');
  requireUnlocked(user);
  user.locked = { ...(user.locked || {}), [db.settings.phase]: now() };
  writeDb();
  return { ...stateFor(user), notice: 'Lukko sisään! Vastauksesi tähän vaiheeseen on tallennettu.' };
});

// ---------- Admin ----------
// Osallistujat ja koodit
route('POST', '/api/admin/users', ({ user, body }) => {
  const names = String(body.names ?? body.name ?? '').split(/[\n,]/).map((n) => clean(n, 40)).filter((n) => n.length >= 1);
  if (!names.length) fail(400, 'Kirjoita vähintään yksi nimi.');
  for (const name of names) {
    if (Object.values(db.users).some((u) => !u.root && norm(u.name) === norm(name))) fail(409, `${name} on jo listalla.`);
  }
  for (const name of names) {
    const u = { id: newId(), name, code: newCode(), token: newToken(), admin: false, createdAt: now() };
    db.users[u.id] = u;
  }
  writeDb();
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/users/:id', ({ user, params, body }) => {
  const u = db.users[params.id];
  if (!u || u.root) fail(404, 'Osallistujaa ei löydy.');
  if ('admin' in body) {
    if (u.id === user.id && !body.admin) fail(400, 'Et voi poistaa admin-oikeutta itseltäsi.');
    u.admin = !!body.admin;
  }
  if ('name' in body) { const n = clean(body.name, 40); if (n) u.name = n; }
  if (body.regenerate) { u.code = newCode(); u.token = newToken(); u.lastLogin = null; }
  if (body.unlock && u.locked) delete u.locked[db.settings.phase];
  writeDb();
  return stateFor(user);
}, { admin: true });

route('DELETE', '/api/admin/users/:id', ({ user, params }) => {
  const u = db.users[params.id];
  if (!u || u.root) fail(404, 'Osallistujaa ei löydy.');
  if (u.id === user.id) fail(400, 'Et voi poistaa itseäsi.');
  delete db.users[u.id];
  db.catVotes = db.catVotes.filter((v) => v.userId !== u.id);
  db.nomVotes = db.nomVotes.filter((v) => v.userId !== u.id);
  delete db.finalVotes[u.id];
  writeDb();
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/phase', ({ user, body }) => {
  const phase = Number(body.phase);
  if (!PHASES[phase]) fail(400, 'Tuntematon vaihe.');
  // Kiinteä kategoria on aina mukana, joten tarkistetaan vain äänestyksellä valittavat
  if (phase >= 3 && !advancedCats().some((c) => !c.fixed)) fail(400, 'Valitse ensin jatkoon pääsevät kategoriat.');
  if (phase >= 4) {
    const missing = advancedCats().filter((c) => !db.nominees.some((n) => n.categoryId === c.id && n.finalist));
    if (missing.length) fail(400, `Valitse finalistit myös näihin: ${missing.map((c) => c.name).join(', ')}.`);
  }
  db.settings.phase = phase;
  writeDb();
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/settings', ({ user, body }) => {
  const s = db.settings;
  if ('deadline' in body) s.deadline = clean(body.deadline, 80);
  for (const k of ['targetCategories', 'catVotes', 'votesP2', 'maxCategoryProposals', 'maxNomineeProposals']) {
    if (k in body) {
      const n = Math.round(Number(body[k]));
      if (!(n >= 1 && n <= 50)) fail(400, 'Lukujen pitää olla välillä 1–50.');
      if (k === 'targetCategories' && n <= fixedCount()) fail(400, `Kategorioita pitää olla enemmän kuin kiinteitä (${fixedCount()}).`);
      s[k] = n;
    }
  }
  writeDb();
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/categories/auto-advance', ({ user }) => {
  const counts = countBy(db.catVotes, 'categoryId');
  const ranked = db.categories.filter((c) => !c.fixed)
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.createdAt.localeCompare(b.createdAt));
  const n = advanceCount();
  ranked.forEach((c, i) => { c.advanced = i < n; });
  writeDb();
  const cutoff = counts[ranked[n - 1]?.id] || 0;
  const tie = ranked.length > n && (counts[ranked[n]?.id] || 0) === cutoff && cutoff > 0;
  return { ...stateFor(user), notice: tie ? `Valittu ${Math.min(n, ranked.length)} eniten ääniä saanutta. Viimeisellä paikalla on tasapeli – tarkista valinta.` : `Valittu ${Math.min(n, ranked.length)} eniten ääniä saanutta.` };
}, { admin: true });

route('POST', '/api/admin/categories/:id', ({ user, params, body }) => {
  const cat = db.categories.find((c) => c.id === params.id) || fail(404, 'Kategoriaa ei löydy.');
  if ('advanced' in body && !cat.fixed) cat.advanced = !!body.advanced;
  if ('name' in body) { const n = clean(body.name, 60); if (n.length >= 3) cat.name = n; }
  if ('description' in body) cat.description = clean(body.description, 160);
  writeDb();
  return stateFor(user);
}, { admin: true });

route('DELETE', '/api/admin/categories/:id', ({ user, params }) => {
  const cat = db.categories.find((c) => c.id === params.id) || fail(404, 'Kategoriaa ei löydy.');
  if (cat.fixed) fail(400, 'Kiinteää kategoriaa ei voi poistaa.');
  const nomIds = new Set(db.nominees.filter((n) => n.categoryId === cat.id).map((n) => n.id));
  db.categories = db.categories.filter((c) => c.id !== cat.id);
  db.catVotes = db.catVotes.filter((v) => v.categoryId !== cat.id);
  db.nominees = db.nominees.filter((n) => !nomIds.has(n.id));
  db.nomVotes = db.nomVotes.filter((v) => !nomIds.has(v.nomineeId));
  for (const fv of Object.values(db.finalVotes)) delete fv[cat.id];
  writeDb();
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/nominees/:id', ({ user, params, body }) => {
  const nom = db.nominees.find((n) => n.id === params.id) || fail(404, 'Ehdokasta ei löydy.');
  if ('finalist' in body) {
    nom.finalist = !!body.finalist;
    if (!nom.finalist) for (const fv of Object.values(db.finalVotes)) if (fv[nom.categoryId] === nom.id) delete fv[nom.categoryId];
  }
  if ('name' in body) { const n = clean(body.name, 60); if (n.length >= 2) nom.name = n; }
  if ('reason' in body) nom.reason = clean(body.reason, 160);
  writeDb();
  return stateFor(user);
}, { admin: true });

route('DELETE', '/api/admin/nominees/:id', ({ user, params }) => {
  const nom = db.nominees.find((n) => n.id === params.id) || fail(404, 'Ehdokasta ei löydy.');
  db.nominees = db.nominees.filter((n) => n.id !== nom.id);
  db.nomVotes = db.nomVotes.filter((v) => v.nomineeId !== nom.id);
  for (const fv of Object.values(db.finalVotes)) if (fv[nom.categoryId] === nom.id) delete fv[nom.categoryId];
  writeDb();
  return stateFor(user);
}, { admin: true });

function requireVoter(user) {
  if (user.root) fail(403, 'Ylläpitotunnuksella ei voi ehdottaa eikä äänestää. Kirjaudu omalla henkilökohtaisella koodillasi.');
}

// Lukitus tallennetaan käyttäjälle vaihekohtaisesti: user.locked = { "1": aikaleima, ... }
function isLocked(user) {
  return !!(user && user.locked && user.locked[db.settings.phase]);
}

function requireUnlocked(user) {
  if (isLocked(user)) fail(409, 'Olet jo lukinnut vastauksesi tähän vaiheeseen. Pyydä järjestäjää avaamaan lukko, jos haluat muuttaa jotain.');
}

function requirePhase(p) {
  if (db.settings.phase !== p) fail(409, `Tämä toiminto on käytössä vain vaiheessa ${p} (${PHASES[p]}).`);
}

// ---------- Staattiset tiedostot ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA: tuntemattomat polut → index.html
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- Palvelin ----------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  // Yksinkertainen CSRF-suoja: muuttavat pyynnöt vain JSON-muodossa samasta originista
  if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'Käytä JSON-pyyntöä.' });
  }

  const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
  if (!r) return send(res, 404, { error: 'Ei löydy.' });
  try {
    const user = currentUser(req);
    if (r.auth !== false && !user) fail(401, 'Kirjaudu ensin sisään.');
    if (r.admin && !user.admin) fail(403, 'Vain adminille.');
    const body = req.method === 'GET' ? {} : await readBody(req);
    const params = r.re.exec(pathname).groups || {};
    send(res, 200, await r.handler({ req, res, user, body, params }));
  } catch (e) {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else { console.error(e); send(res, 500, { error: 'Palvelinvirhe.' }); }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Default Settings Gaala käynnissä: http://${HOST}:${PORT}`);
  // Auttaa vianetsinnässä paljastamatta koodia: näyttää pituuden ja ensimmäisen merkin
  console.log(`ADMIN_CODE ladattu: ${ADMIN_CODE.length} merkkiä, alkaa "${ADMIN_CODE[0]}"${ADMIN_CODE === 'vaihda-tama-pitkaan-koodiin' ? ' – HUOM: tämä on esimerkkiarvo, vaihda se .env-tiedostoon!' : ''}`);
});
