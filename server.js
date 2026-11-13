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
const IMG_DIR = path.join(DATA_DIR, 'images'); // osallistujien ja ehdokkaiden kuvat (samassa volyymissa kuin db.json)

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
      nextStart: '', // milloin seuraava vaihe alkaa (näkyy odotusnäytöllä); tyhjenee vaiheen vaihtuessa
      phaseEnds: {}, // vaiheiden 1–4 päättymisajat muodossa "2026-12-04T20:00" (näkyvät vaihepalkissa)
      targetCategories: 8, // kategorioita gaalassa (sis. kiinteät); äänestyksellä valitaan tämä − kiinteät
      catVotes: 3, // ääniä per henkilö kategoria-äänestyksessä (vaihe 2)
      votesP2: 2, // ääniä per kategoria ehdokasvaiheessa (vaihe 3; oma ehdotus vie yhden)
      maxCategoryProposals: 3, // kategoriaehdotuksia per henkilö
      maxNomineeProposals: 2, // ehdokasehdotuksia per henkilö per kategoria
      finalists: 3, // automaattisesti valittavia finalisteja per kategoria
      phaseScheme: 2, // vaiheiden numerointi (2 = viisi vaihetta)
    },
    users: {},
    categories: [{ id: fixedId, name: FIXED_CATEGORY.name, description: FIXED_CATEGORY.description, fixed: true, advanced: true, by: null, createdAt: now() }],
    catVotes: [],
    nominees: [],
    nomVotes: [],
    finalVotes: {},
    finalVoteAt: {}, // milloin finaaliääni annettiin: { userId: { categoryId: aikaleima } }
    feedback: [], // palautteet: { id, userId, phase, text, createdAt }; phase 1–4 = odotustila lukituksen jälkeen, 5 = suljettu
    // Profiilikuvien versiot: kaikki ehdotetut, adminin lisäämät ja aiemmat kuvat säilyvät, ja admin voi vaihtaa niiden välillä.
    // { id, personId, by, image, crop, source: 'suggestion' | 'admin' | 'previous', withdrawn, createdAt }
    photoSuggestions: [],
    // Hall of Fame: aiempien vuosien gaalat. { id, year, categories: [{ name, description, nominees: [{ name, reason, personId, winner }] }] }
    hallOfFame: [],
  };
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });
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
  if (st.finalists == null) st.finalists = 3;
  // Vanha 4-vaiheinen versio (1 kategoriat, 2 ehdokkaat, 3 finaali, 4 suljettu) → uudet numerot.
  // Vanha vaihe 1 (ehdotukset + äänet samassa) pysyy vaiheena 1; muut siirtyvät yhdellä eteenpäin.
  if (!st.phaseScheme) {
    if (st.phase >= 2) st.phase += 1;
    st.phaseScheme = 2;
  }
  // Kuvaversiot: nykyiset profiilikuvat mukaan versiolistaan, jotta niihin voi palata
  data.photoSuggestions = data.photoSuggestions || [];
  for (const u of Object.values(data.users)) {
    if (u.photo && !data.photoSuggestions.some((x) => x.personId === u.id && x.image === u.photo)) {
      data.photoSuggestions.push({ id: newId(), personId: u.id, by: null, image: u.photo, crop: u.photoCrop || null, source: 'previous', createdAt: u.createdAt || now() });
    }
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

function readBody(req, max = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'Liian suuri pyyntö')); req.destroy(); } else chunks.push(c); });
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

// ---------- Kuvat ----------
// Selain pienentää kuvan ennen lähetystä (JPEG, max 800 px), joten palvelin vain tarkistaa ja tallentaa sen.
// Tiedostonimi on satunnainen id, joten vanha kuva ei jää selaimen välimuistiin vaihdon jälkeen.
const IMG_TYPES = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] };
const IMG_NAME = /^[0-9a-f]{16}\.(jpg|png|webp)$/;

function saveImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) fail(400, 'Kuvan pitää olla JPEG-, PNG- tai WebP-muodossa.');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) fail(413, 'Kuva on liian suuri (max 8 Mt).');
  if (!IMG_TYPES[ext].every((b, i) => buf[i] === b)) fail(400, 'Tiedosto ei ole kelvollinen kuva.');
  const name = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(IMG_DIR, name), buf);
  return name;
}

function deleteImage(name) {
  if (name && IMG_NAME.test(name)) fs.rm(path.join(IMG_DIR, name), { force: true }, () => {});
}

const imgUrl = (name) => (name ? `/images/${name}` : null);

// Rajaus: kohdistuspiste (x, y prosentteina) ja zoom (1–4). Alkuperäinen kuva säilyy, joten rajausta voi muuttaa myöhemmin.
const DEFAULT_CROP = { x: 50, y: 50, z: 1 };

// Kuvaversiot (db.photoSuggestions). Profiilikuvaa vaihdettaessa vanha kuva jää versioksi, joten tiedostoja ei poisteta.
function photoVersionOf(u) { return u.photo ? (db.photoSuggestions || []).find((x) => x.personId === u.id && x.image === u.photo) : null; }
function keepCurrentPhoto(u) {
  db.photoSuggestions = db.photoSuggestions || [];
  const v = photoVersionOf(u);
  if (v) v.crop = u.photoCrop || null; // nykyinen rajaus talteen, jotta versioon palatessa se säilyy
  else if (u.photo) db.photoSuggestions.push({ id: newId(), personId: u.id, by: null, image: u.photo, crop: u.photoCrop || null, source: 'previous', createdAt: now() });
}
function setProfilePhoto(u, version) {
  keepCurrentPhoto(u);
  u.photo = version.image;
  u.photoCrop = version.crop || null;
  // Korttien rajaukset koskivat vanhaa kuvaa (jos kortilla ei ole omaa kuvaa)
  for (const n of db.nominees) if (n.personId === u.id && !n.photo) n.crop = null;
}
function cleanCrop(c) {
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return { x: num(c && c.x, 0, 100, 50), y: num(c && c.y, 0, 100, 50), z: num(c && c.z, 1, 4, 1) };
}
const photoOf = (name, crop) => (name ? { src: imgUrl(name), ...(crop || DEFAULT_CROP) } : null);

// Kuvat näytetään vain kirjautuneille (sivu on julkisessa osoitteessa)
function serveImage(req, res, pathname) {
  const name = pathname.slice('/images/'.length);
  if (!currentUser(req) || !IMG_NAME.test(name)) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(IMG_DIR, name), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)], 'Cache-Control': 'private, max-age=31536000, immutable' });
    res.end(data);
  });
}

// ---------- Henkilöt ja ehdokkaat ----------
// Ehdokas on henkilö (osallistuja) + peruste. Nimi ja kuva tulevat henkilöltä, ellei ehdokkaalle ole asetettu omaa kuvaa.
const people = () => Object.values(db.users).filter((u) => !u.root && !u.tester && u.nominable !== false).sort((a, b) => a.name.localeCompare(b.name, 'fi'));
const nomName = (n) => (n.personId && db.users[n.personId] ? db.users[n.personId].name : n.name);
// Kortin oma kuva voittaa; muuten henkilön kuva. Kortin oma rajaus voittaa henkilön rajauksen.
// "Alle K18" -tila: kaikkialla näytetään henkilön erikseen valittu <18-kuva. Jos sitä ei ole valittu, näytetään
// nimikirjain (ei normaalia kuvaa). Ehdokaskorttien omat kuvat ohitetaan tässä tilassa.
function displayPhoto(u) {
  if (!u) return null;
  return db.settings.safeMode ? photoOf(u.safePhoto, u.safePhotoCrop) : photoOf(u.photo, u.photoCrop);
}
function nomPhoto(n) {
  if (db.settings.safeMode) return displayPhoto(n.personId && db.users[n.personId]);
  if (n.photo) return photoOf(n.photo, n.crop);
  const p = n.personId && db.users[n.personId];
  return p && p.photo ? photoOf(p.photo, n.crop || p.photoCrop) : null;
}
const userName = (id) => (id && db.users[id] ? db.users[id].name : null);

// Ehdokasvaiheen äänivaatimus: jokaisessa kategoriassa käytettävä kaikki äänet (tai niin monta kuin ehdokkaita on)
function nomVoteNeed(uid) {
  return advancedCats().map((c) => {
    const ids = new Set(db.nominees.filter((n) => n.categoryId === c.id).map((n) => n.id));
    const need = Math.min(db.settings.votesP2, ids.size);
    const have = uid ? db.nomVotes.filter((v) => v.userId === uid && ids.has(v.nomineeId)).length : 0;
    return { cat: c, need, have };
  });
}

// Voiko osallistuja lukita tämän vaiheen? Sama tarkistus palvelimella ja napissa.
function lockReady(user) {
  const p = db.settings.phase; const uid = user.id;
  if (p === 2 && !db.catVotes.some((v) => v.userId === uid)) return { ok: false, reason: 'Äänestä vähintään yhtä kategoriaa ennen lukitsemista.' };
  if (p === 3) {
    const missing = nomVoteNeed(uid).filter((x) => x.have < x.need);
    if (missing.length) return { ok: false, reason: `Käytä kaikki äänesi ennen lukitsemista. Ääniä puuttuu: ${missing.map((x) => `${x.cat.name} (${x.have}/${x.need})`).join(', ')}.` };
  }
  if (p === 4 && !Object.keys(db.finalVotes[uid] || {}).length) return { ok: false, reason: 'Äänestä vähintään yhtä finalistia ennen lukitsemista.' };
  return { ok: true, reason: '' };
}

function removeCategory(cat) {
  const doomed = db.nominees.filter((n) => n.categoryId === cat.id);
  const nomIds = new Set(doomed.map((n) => n.id));
  doomed.forEach((n) => deleteImage(n.photo));
  db.categories = db.categories.filter((c) => c.id !== cat.id);
  db.catVotes = db.catVotes.filter((v) => v.categoryId !== cat.id);
  db.nominees = db.nominees.filter((n) => !nomIds.has(n.id));
  db.nomVotes = db.nomVotes.filter((v) => !nomIds.has(v.nomineeId));
  for (const fv of Object.values(db.finalVotes)) delete fv[cat.id];
}

function removeNominee(nom) {
  deleteImage(nom.photo);
  db.nominees = db.nominees.filter((n) => n.id !== nom.id);
  db.nomVotes = db.nomVotes.filter((v) => v.nomineeId !== nom.id);
  for (const fv of Object.values(db.finalVotes)) if (fv[nom.categoryId] === nom.id) delete fv[nom.categoryId];
}

// ---------- Näkymä käyttäjälle ----------
const fixedCount = () => db.categories.filter((c) => c.fixed).length;
// Äänestyksellä valittavien kategorioiden määrä = gaalan kategoriat ilman kiinteitä (ne ovat mukana joka tapauksessa)
const advanceCount = () => Math.max(1, db.settings.targetCategories - fixedCount());

const advancedCats = () => db.categories.filter((c) => c.advanced);

// opts.phase: testikäyttäjän esikatseltava vaihe (muille aina oikea vaihe)
function stateFor(user, opts = {}) {
  const s = db.settings;
  const preview = !!(user && user.tester && PHASES[opts.phase]);
  const phase = preview ? Number(opts.phase) : s.phase;
  const base = {
    phase,
    phaseName: PHASES[phase],
    realPhase: s.phase,
    deadline: s.deadline,
    nextStart: s.nextStart || '',
    phaseEnds: s.phaseEnds || {},
    limits: { targetCategories: s.targetCategories, fixedCategories: fixedCount(), advanceCount: advanceCount(), catVotes: s.catVotes, votesP2: s.votesP2, finalists: s.finalists, maxCategoryProposals: s.maxCategoryProposals, maxNomineeProposals: s.maxNomineeProposals },
    me: user ? { name: user.name, admin: !!user.admin, root: !!user.root, tester: !!user.tester, locked: user.tester ? false : isLocked(user), photo: displayPhoto(user) } : null,
  };
  if (!user) return base;
  const uid = user.id;

  const myCatVotes = new Set(db.catVotes.filter((v) => v.userId === uid).map((v) => v.categoryId));
  const myNomVotes = new Set(db.nomVotes.filter((v) => v.userId === uid).map((v) => v.nomineeId));
  const myFinal = db.finalVotes[uid] || {};

  const visibleCats = phase <= 2 ? db.categories : advancedCats();
  base.categories = visibleCats.map((c) => ({
    id: c.id, name: c.name, description: c.description, fixed: !!c.fixed, advanced: !!c.advanced,
    mine: c.by === uid, myVote: myCatVotes.has(c.id),
  }));

  const visibleNoms = phase === 3
    ? db.nominees.filter((n) => advancedCats().some((c) => c.id === n.categoryId))
    : phase >= 4 ? db.nominees.filter((n) => n.finalist) : [];
  base.nominees = visibleNoms.map((n) => ({
    id: n.id, categoryId: n.categoryId, personId: n.personId || null, name: nomName(n), reason: n.reason, photo: nomPhoto(n), finalist: !!n.finalist,
    mine: n.by === uid, myVote: myNomVotes.has(n.id), myFinal: myFinal[n.categoryId] === n.id,
  }));
  base.people = people().map((u) => ({ id: u.id, name: u.name, photo: displayPhoto(u) }));
  // Kuvaversiot: osallistuja näkee omat ehdotuksensa (ei peruttuja), admin kaikki versiot ehdottajineen
  const seen = user.photosSeenAt || '';
  base.photoSuggestions = (db.photoSuggestions || [])
    .filter((x) => db.users[x.personId] && (user.admin || (x.by === uid && !x.withdrawn && (x.source || 'suggestion') === 'suggestion')))
    .map((x) => {
      const v = { id: x.id, personId: x.personId, src: imgUrl(x.image), crop: x.crop || null, createdAt: x.createdAt, mine: x.by === uid, current: db.users[x.personId].photo === x.image };
      if (user.admin) Object.assign(v, { byName: userName(x.by), source: x.source || 'suggestion', withdrawn: !!x.withdrawn, safe: db.users[x.personId].safePhoto === x.image });
      return v;
    });
  if (user.admin) base.photoNew = (db.photoSuggestions || []).filter((x) => db.users[x.personId] && (x.source || 'suggestion') === 'suggestion' && x.by !== uid && !x.withdrawn && x.createdAt > seen).length;
  // Palaute: suljetussa vaiheessa ja jokaisen vaiheen odotustilassa (lukituksen jälkeen). Kukin näkee saman vaiheen
  // palautteet. Muille nimettömänä: kirjoittajaa ei lähetetä selaimeen lainkaan (vain oma-lippu).
  if (phase === 5 || isLocked(user) || user.tester) {
    base.feedback = (db.feedback || []).filter((f) => (f.phase || 5) === phase).map((f) => ({ id: f.id, text: f.text, createdAt: f.createdAt, mine: f.userId === uid }));
  }

  base.used = {
    catVotes: myCatVotes.size,
    catProposals: db.categories.filter((c) => c.by === uid).length,
  };
  // Testikäyttäjän lukitusehdot lasketaan selaimessa paikallisen kokeilun mukaan
  base.lockReady = user.root || user.tester ? { ok: !user.root, reason: '' } : lockReady(user);


  base.hallOfFame = hofView();

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
      id: u.id, name: u.name, code: fmtCode(u.code), admin: !!u.admin, joined: !!u.lastLogin, photo: photoOf(u.photo, u.photoCrop), safePhoto: photoOf(u.safePhoto, u.safePhotoCrop), shownPhoto: displayPhoto(u), nominable: u.nominable !== false, tester: !!u.tester,
      p1: db.categories.filter((c) => c.by === u.id).length,
      p2: db.catVotes.filter((v) => v.userId === u.id).length,
      p3: db.nomVotes.filter((v) => v.userId === u.id).length,
      p4: Object.keys(db.finalVotes[u.id] || {}).length,
      locked: isLocked(u),
    })).sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    categories: db.categories.map((c) => ({ id: c.id, name: c.name, description: c.description, fixed: !!c.fixed, advanced: !!c.advanced, votes: catCounts[c.id] || 0, byName: userName(c.by) })),
    nominees: db.nominees.map((n) => ({ id: n.id, categoryId: n.categoryId, personId: n.personId || null, name: nomName(n), reason: n.reason, photo: nomPhoto(n), ownPhoto: !!n.photo, finalist: !!n.finalist, votes: nomCounts[n.id] || 0, finalVotes: fin[n.id] || 0, byName: userName(n.by),
      finalVoters: db.settings.phase >= 4 ? Object.entries(db.finalVotes).filter(([, v]) => v[n.categoryId] === n.id).map(([uid]) => userName(uid) || 'poistettu').sort((a, b) => a.localeCompare(b, 'fi')) : [] })),
    safeMode: !!db.settings.safeMode,
    nomVoteNeed: nomVoteNeed(null).reduce((sum, x) => sum + x.need, 0),
    voters: { p1: new Set(db.categories.filter((c) => c.by).map((c) => c.by)).size, p2: new Set(db.catVotes.map((v) => v.userId)).size, p3: new Set(db.nomVotes.map((v) => v.userId)).size, p4: Object.keys(db.finalVotes).length },
    locked: Object.values(db.users).filter((u) => !u.root && !u.tester && isLocked(u)).length,
    winners: winnersFor(advancedCats().map((c) => c.id)),
    // Palauteloki: vain adminit näkevät kirjoittajan
    feedbackLog: (db.feedback || []).map((f) => ({ id: f.id, phase: f.phase || 5, name: userName(f.userId) || 'Poistettu osallistuja', text: f.text, createdAt: f.createdAt })),
  };
}

// ---------- Hall of Fame ----------
// Aiempien vuosien voittajat ja ehdokkaat. Hall of Famen kuvat ovat omia kuviaan (n.image), eivät osallistujien
// profiilikuvia, joten osallistujan poisto tai profiilikuvan vaihto ei muuta niitä. Alle K18 -tilassa kuvat piilotetaan
// (niille ei ole <18-versiota) ja tilalla näkyy nimikirjain. Nimi tallennetaan erikseen, joten se säilyy aina.
function hofView() {
  return (db.hallOfFame || []).slice().sort((a, b) => b.year - a.year).map((y) => ({
    id: y.id, year: y.year,
    categories: y.categories.map((c) => ({
      name: c.name, description: c.description || '',
      nominees: c.nominees.map((n) => ({ name: n.name, reason: n.reason || '', winner: !!n.winner, personId: n.personId && db.users[n.personId] ? n.personId : null, image: n.image || null, imageSrc: imgUrl(n.image), crop: n.crop || null, photo: db.settings.safeMode ? null : photoOf(n.image, n.crop) })),
    })),
  }));
}

// Lomakkeelta tuleva rakenne: [{ name, description, nominees: [{ personId, name, reason, winner }] }].
// Osallistujaan linkitetyn ehdokkaan nimi otetaan osallistujalta; muuten käytetään kirjoitettua nimeä.
// Tyhjät ehdokasrivit ja kokonaan tyhjät kategoriat ohitetaan.
function cleanHofCategories(list) {
  if (!Array.isArray(list)) fail(400, 'Kategoriat puuttuvat.');
  const out = [];
  for (const c of list.slice(0, 40)) {
    const name = clean(c && c.name, 80);
    const nominees = [];
    for (const n of (Array.isArray(c && c.nominees) ? c.nominees : []).slice(0, 30)) {
      const person = n && n.personId && db.users[n.personId] && !db.users[n.personId].root ? db.users[n.personId] : null;
      const nName = person ? person.name : clean(n && n.name, 60);
      if (!nName) continue;
      const image = typeof n.image === 'string' && IMG_NAME.test(n.image) && fs.existsSync(path.join(IMG_DIR, n.image)) ? n.image : null;
      // Rajaus säilyy vain kuvan mukana (siirrosta tulleet ehdokaskorttien kuvat); uudelle kuvalle lomake lähettää null
      const crop = image && n.crop ? cleanCrop(n.crop) : null;
      nominees.push({ name: nName, reason: clean(n.reason, 160), personId: person ? person.id : null, winner: !!n.winner, image, crop });
    }
    if (!name && !nominees.length) continue;
    if (!name) fail(400, 'Jokaisella kategorialla pitää olla nimi.');
    if (!nominees.length) fail(400, `Lisää kategoriaan "${name}" vähintään yksi ehdokas.`);
    out.push({ name, description: clean(c.description, 200), nominees });
  }
  if (!out.length) fail(400, 'Lisää vähintään yksi kategoria.');
  return out;
}

// Hall of Famen kuvatiedostot, joita mikään vuosi ei enää käytä, poistetaan levyltä
const hofImages = (entries) => new Set(entries.flatMap((y) => y.categories.flatMap((c) => c.nominees.map((n) => n.image).filter(Boolean))));
function dropUnusedHofImages(before) {
  const used = hofImages(db.hallOfFame || []);
  for (const img of before) if (!used.has(img)) deleteImage(img);
}

function cleanYear(v) {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) fail(400, 'Anna vuosi muodossa 2025.');
  return y;
}

// ---------- Reitit ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

route('GET', '/api/state', ({ user, req }) => stateFor(user, { phase: Number(new URL(req.url, 'http://x').searchParams.get('phase')) || null }), { auth: false });

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

// Osallistuja muokkaa omaa kategoriaehdotustaan (vaihe 1, ennen lukitusta)
route('POST', '/api/categories/:id/edit', ({ user, params, body }) => {
  requirePhase(1);
  requireVoter(user);
  requireUnlocked(user);
  const cat = db.categories.find((c) => c.id === params.id && c.by === user.id) || fail(404, 'Voit muokata vain omia ehdotuksiasi.');
  applyCategoryEdit(cat, body);
  writeDb();
  return stateFor(user);
});

// Osallistuja poistaa oman kategoriaehdotuksensa (vaihe 1, ennen lukitusta)
route('DELETE', '/api/categories/:id', ({ user, params }) => {
  requirePhase(1);
  requireVoter(user);
  requireUnlocked(user);
  const cat = db.categories.find((c) => c.id === params.id && c.by === user.id) || fail(404, 'Voit poistaa vain omia ehdotuksiasi.');
  removeCategory(cat);
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
    db.catVotes.push({ userId: user.id, categoryId: cat.id, at: now() });
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
  const person = db.users[body.personId];
  if (!person || person.root || person.nominable === false) fail(404, 'Valitse ehdokas korteista.');
  const reason = clean(body.reason, 160);
  if (reason.length < 3) fail(400, 'Kirjoita myös mistä ehdotat – sama henkilö voi olla ehdolla useammasta aiheesta.');
  if (db.nominees.some((n) => n.categoryId === cat.id && n.personId === person.id && norm(n.reason) === norm(reason))) fail(409, 'Sama ehdotus on jo listalla – äänestä sitä.');
  const mine = db.nominees.filter((n) => n.categoryId === cat.id && n.by === user.id).length;
  if (mine >= db.settings.maxNomineeProposals) fail(400, `Voit ehdottaa enintään ${db.settings.maxNomineeProposals} ehdokasta per kategoria.`);
  // Ehdotus ei anna ääntä: osallistuja äänestää erikseen
  db.nominees.push({ id: newId(), categoryId: cat.id, personId: person.id, name: person.name, reason, photo: null, finalist: false, by: user.id, createdAt: now() });
  writeDb();
  return stateFor(user);
});

// Osallistuja poistaa oman ehdokasehdotuksensa (vaihe 3, ennen lukitusta). Myös muiden äänet sille poistuvat.
route('DELETE', '/api/nominees/:id', ({ user, params }) => {
  requirePhase(3);
  requireVoter(user);
  requireUnlocked(user);
  const nom = db.nominees.find((n) => n.id === params.id && n.by === user.id) || fail(404, 'Voit poistaa vain omia ehdotuksiasi.');
  removeNominee(nom);
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
    db.nomVotes.push({ userId: user.id, nomineeId: nom.id, at: now() });
  }
  writeDb();
  return stateFor(user);
});

// Osallistuja muokkaa omaa ehdokasehdotustaan (vaihe 3, ennen lukitusta)
route('POST', '/api/nominees/:id/edit', ({ user, params, body }) => {
  requirePhase(3);
  requireVoter(user);
  requireUnlocked(user);
  const nom = db.nominees.find((n) => n.id === params.id && n.by === user.id) || fail(404, 'Voit muokata vain omia ehdotuksiasi.');
  applyNomineeEdit(nom, body);
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
  db.finalVoteAt = db.finalVoteAt || {};
  db.finalVoteAt[user.id] = { ...(db.finalVoteAt[user.id] || {}), [nom.categoryId]: now() };
  writeDb();
  return stateFor(user);
});

// Vastausten lukitus ("Lukko sisään"): vahvistaa, että osallistuja on valmis tämän vaiheen kanssa.
// Lukituksen jälkeen vaiheen ääniä ja ehdotuksia ei voi muuttaa; järjestäjä voi avata lukon hallinnasta.
route('POST', '/api/lock', ({ user }) => {
  requireVoter(user);
  if (db.settings.phase > 4) fail(409, 'Äänestys on jo suljettu.');
  requireUnlocked(user);
  const ready = lockReady(user);
  if (!ready.ok) fail(400, ready.reason);
  user.locked = { ...(user.locked || {}), [db.settings.phase]: now() };
  writeDb();
  return { ...stateFor(user), notice: 'Lukko sisään! Vastauksesi tähän vaiheeseen on tallennettu.' };
});

// Palaute suljetussa vaiheessa ja jokaisen vaiheen odotustilassa (kun omat vastaukset on lukittu).
// Muille osallistujille nimetön, adminit näkevät kirjoittajan palautelokista vaiheittain eriteltynä.
route('POST', '/api/feedback', ({ user, body }) => {
  requireVoter(user);
  const phase = db.settings.phase;
  if (phase !== 5 && !isLocked(user)) fail(409, 'Palautteen voi lähettää, kun olet lukinnut vastauksesi.');
  const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 1000);
  if (text.length < 2) fail(400, 'Kirjoita palaute ensin.');
  db.feedback = db.feedback || [];
  if (db.feedback.filter((f) => f.userId === user.id && (f.phase || 5) === phase).length >= 20) fail(400, 'Olet jo lähettänyt paljon palautetta.');
  db.feedback.push({ id: newId(), userId: user.id, phase, text, createdAt: now() });
  writeDb();
  return { ...stateFor(user), notice: 'Palaute lähetetty.' };
});

// Lähetettyä palautetta ei voi poistaa itse; vain admin voi poistaa (palautelokista)
route('DELETE', '/api/feedback/:id', ({ user, params }) => {
  const f = (db.feedback || []).find((x) => x.id === params.id) || fail(404, 'Palautetta ei löydy.');
  db.feedback = db.feedback.filter((x) => x.id !== f.id);
  writeDb();
  return stateFor(user);
}, { admin: true });

// ---------- Profiilikuvaehdotukset ----------
// Kuka tahansa kirjautunut voi ehdottaa kuvaa kenen tahansa ehdokaskorttiin; adminit näkevät kaikki ehdotukset
// ja voivat ottaa ehdotuksen henkilön profiilikuvaksi tai poistaa sen. Ehdottaja voi poistaa omansa.
const SUGG_PER_PERSON = 5, SUGG_PER_USER = 40;
route('POST', '/api/photo-suggestions', ({ user, body }) => {
  if (user.tester) fail(403, 'Testikäyttäjä: muutoksia ei tallenneta.');
  const person = db.users[body.personId];
  if (!person || person.root || person.tester) fail(404, 'Henkilöä ei löydy.');
  db.photoSuggestions = db.photoSuggestions || [];
  const mine = db.photoSuggestions.filter((x) => x.by === user.id && !x.withdrawn && (x.source || 'suggestion') === 'suggestion');
  if (mine.filter((x) => x.personId === person.id).length >= SUGG_PER_PERSON) fail(400, `Olet jo ehdottanut ${SUGG_PER_PERSON} kuvaa henkilölle ${person.name}. Poista jokin ensin.`);
  if (mine.length >= SUGG_PER_USER) fail(400, 'Olet ehdottanut jo todella monta kuvaa. Poista jokin ensin.');
  const image = saveImage(body.image);
  db.photoSuggestions.push({ id: newId(), personId: person.id, by: user.id, image, crop: null, source: 'suggestion', createdAt: now() });
  writeDb();
  return { ...stateFor(user), notice: `Kuvaehdotus lähetetty: ${person.name}.` };
}, { maxBody: 12 * 1024 * 1024 });

// Osallistuja perii oman ehdotuksensa: se katoaa hänen näkymästään, mutta jää adminien versiolistaan.
// Admin poistaa version pysyvästi (myös tiedoston). Käytössä olevaa kuvaa ei voi poistaa.
route('DELETE', '/api/photo-suggestions/:id', ({ user, params }) => {
  const x = (db.photoSuggestions || []).find((y) => y.id === params.id) || fail(404, 'Kuvaa ei löydy.');
  const person = db.users[x.personId];
  if (user.admin) {
    if (person && person.photo === x.image) fail(400, 'Kuva on käytössä profiilikuvana. Vaihda ensin toinen kuva.');
    if (person && person.safePhoto === x.image) fail(400, 'Kuva on valittu <18-kuvaksi. Poista valinta ensin.');
    deleteImage(x.image);
    db.photoSuggestions = db.photoSuggestions.filter((y) => y.id !== x.id);
  } else {
    if (x.by !== user.id) fail(403, 'Voit poistaa vain omia ehdotuksiasi.');
    x.withdrawn = true;
  }
  writeDb();
  return { ...stateFor(user), notice: user.admin ? 'Kuva poistettu.' : 'Kuvaehdotus poistettu.' };
});

// Admin avasi kuvanäkymän: uusien ehdotusten laskuri nollautuu
route('POST', '/api/admin/photos-seen', ({ user }) => {
  user.photosSeenAt = now();
  writeDb();
  return stateFor(user);
}, { admin: true });

// Admin vaihtaa henkilön profiilikuvaksi minkä tahansa version (vanha kuva jää versioksi)
route('POST', '/api/admin/photo-suggestions/:id/accept', ({ user, params }) => {
  const x = (db.photoSuggestions || []).find((y) => y.id === params.id) || fail(404, 'Kuvaa ei löydy.');
  const u = db.users[x.personId];
  if (!u || u.root) fail(404, 'Henkilöä ei löydy.');
  setProfilePhoto(u, x);
  writeDb();
  return { ...stateFor(user), notice: `Profiilikuva vaihdettu: ${u.name}.` };
}, { admin: true });

// <18-kuva: admin valitsee version, joka näytetään "Alle K18" -tilassa. Uudelleen valinta poistaa valinnan.
route('POST', '/api/admin/photo-suggestions/:id/safe', ({ user, params }) => {
  const x = (db.photoSuggestions || []).find((y) => y.id === params.id) || fail(404, 'Kuvaa ei löydy.');
  const u = db.users[x.personId];
  if (!u || u.root) fail(404, 'Henkilöä ei löydy.');
  if (u.safePhoto === x.image) { u.safePhoto = null; u.safePhotoCrop = null; writeDb(); return { ...stateFor(user), notice: `<18-kuva poistettu: ${u.name}.` }; }
  u.safePhoto = x.image;
  u.safePhotoCrop = x.crop || null;
  writeDb();
  return { ...stateFor(user), notice: `<18-kuva valittu: ${u.name}.` };
}, { admin: true });

route('DELETE', '/api/admin/users/:id/safe-photo', ({ user, params }) => {
  const u = db.users[params.id];
  if (!u || u.root) fail(404, 'Osallistujaa ei löydy.');
  u.safePhoto = null; u.safePhotoCrop = null;
  writeDb();
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/users/:id/safe-crop', ({ user, params, body }) => {
  const u = db.users[params.id];
  if (!u || u.root || !u.safePhoto) fail(404, 'Osallistujalla ei ole <18-kuvaa.');
  u.safePhotoCrop = cleanCrop(body);
  writeDb();
  return { ...stateFor(user), notice: '<18-kuvan rajaus tallennettu.' };
}, { admin: true });

// Koko gaalan nollaus. Vaatii vahvistussanan, ja nykyinen tietokanta tallennetaan ensin varmuuskopioksi
// data-kansioon. Kuvatiedostoja ei poisteta, jotta varmuuskopion palautus toimii kuvineen.
route('POST', '/api/admin/reset', ({ user, body }) => {
  if (body.confirm !== 'NOLLAA') fail(400, 'Vahvista nollaus kirjoittamalla NOLLAA.');
  const backup = `db-ennen-nollausta-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.copyFileSync(DB_FILE, path.join(DATA_DIR, backup));
  db.categories = db.categories.filter((c) => c.fixed).map((c) => ({ ...c, advanced: true }));
  db.catVotes = []; db.nominees = []; db.nomVotes = [];
  db.finalVotes = {}; db.finalVoteAt = {}; db.feedback = [];
  db.settings.phase = 1; db.settings.deadline = ''; db.settings.nextStart = ''; db.settings.phaseEnds = {};
  for (const u of Object.values(db.users)) u.locked = {};
  if (body.users) for (const u of Object.values(db.users)) if (!u.root) delete db.users[u.id];
  db.photoSuggestions = (db.photoSuggestions || []).filter((x) => db.users[x.personId]);
  writeDb();
  const notice = `Gaala nollattu. Varmuuskopio tallennettu: ${backup}`;
  // Jos admin poisti samalla oman osallistujatunnuksensa, palataan kirjautumissivulle
  return db.users[user.id] ? { ...stateFor(user), notice } : { ...stateFor(null), notice };
}, { admin: true });

// Hall of Fame: vuoden lisäys tai muokkaus lomakkeelta (id puuttuu = uusi vuosi)
route('POST', '/api/admin/hof', ({ user, body }) => {
  const year = cleanYear(body.year);
  const categories = cleanHofCategories(body.categories);
  db.hallOfFame = db.hallOfFame || [];
  const entry = body.id ? db.hallOfFame.find((y) => y.id === body.id) : null;
  if (body.id && !entry) fail(404, 'Vuotta ei löydy.');
  if (db.hallOfFame.some((y) => y.year === year && y !== entry)) fail(409, `Vuosi ${year} on jo Hall of Famessa. Muokkaa sitä.`);
  const before = entry ? hofImages([entry]) : new Set();
  if (entry) Object.assign(entry, { year, categories, updatedAt: now() });
  else db.hallOfFame.push({ id: newId(), year, categories, createdAt: now() });
  writeDb();
  dropUnusedHofImages(before);
  return { ...stateFor(user), notice: `Gaala ${year} tallennettu Hall of Fameen.` };
}, { admin: true, maxBody: 60000 });

// Hall of Fame -ehdokkaan kuva: tallennetaan heti, ja lomake liittää tiedostonimen ehdokkaaseen tallennettaessa.
// Kuva on erillinen tiedosto, ei osallistujan profiilikuva.
route('POST', '/api/admin/hof/image', ({ body }) => {
  const image = saveImage(body.image);
  return { image, src: imgUrl(image) };
}, { admin: true, maxBody: 12 * 1024 * 1024 });

// Ehdokaskortin oma kuva Hall of Fameen: tiedostosta tehdään kopio, jotta ehdokkaan poisto tai gaalan nollaus ei vie
// sitä Hall of Famesta (eikä Hall of Famen muokkaus ehdokkaalta). Rajaus kopioidaan mukana.
function copyCardPhoto(n) {
  if (!n.photo || !IMG_NAME.test(n.photo)) return { image: null, crop: null };
  const image = `${newId()}${path.extname(n.photo)}`;
  try { fs.copyFileSync(path.join(IMG_DIR, n.photo), path.join(IMG_DIR, image)); } catch { return { image: null, crop: null }; }
  return { image, crop: n.crop || null };
}

// Tämän vuoden tulokset Hall of Fameen: gaalaan päässeet kategoriat, finalistit ja voittajat (tasapelissä kaikki).
// Ehdokaskorttien omat kuvat kopioidaan; profiilikuvia ei käytetä (puuttuvat kuvat lisätään muokkauslomakkeella).
route('POST', '/api/admin/hof/archive', ({ user, body }) => {
  if (db.settings.phase !== 5) fail(409, 'Tulokset voi arkistoida, kun äänestys on suljettu (vaihe 5).');
  const year = cleanYear(body.year);
  db.hallOfFame = db.hallOfFame || [];
  if (db.hallOfFame.some((y) => y.year === year)) fail(409, `Vuosi ${year} on jo Hall of Famessa. Poista tai muokkaa sitä ensin.`);
  const cats = advancedCats();
  const winners = winnersFor(cats.map((c) => c.id));
  const categories = cats.map((c) => ({
    name: c.name, description: c.description || '',
    nominees: db.nominees.filter((n) => n.categoryId === c.id && n.finalist).map((n) => ({ name: nomName(n), reason: n.reason || '', personId: n.personId || null, winner: winners[c.id].includes(n.id), ...copyCardPhoto(n) }))
      .sort((a, b) => (b.winner - a.winner) || a.name.localeCompare(b.name, 'fi')),
  })).filter((c) => c.nominees.length);
  if (!categories.length) fail(409, 'Finalisteja ei ole, joten arkistoitavaa ei ole.');
  db.hallOfFame.push({ id: newId(), year, categories, createdAt: now() });
  writeDb();
  return { ...stateFor(user), notice: `Gaalan ${year} tulokset lisätty Hall of Fameen.` };
}, { admin: true });

route('DELETE', '/api/admin/hof/:id', ({ user, params }) => {
  const entry = (db.hallOfFame || []).find((y) => y.id === params.id);
  if (!entry) fail(404, 'Vuotta ei löydy.');
  db.hallOfFame = db.hallOfFame.filter((y) => y !== entry);
  writeDb();
  dropUnusedHofImages(hofImages([entry]));
  return { ...stateFor(user), notice: `Gaala ${entry.year} poistettu Hall of Famesta.` };
}, { admin: true });

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
  if ('nominable' in body) u.nominable = !!body.nominable;
  if ('tester' in body) u.tester = !!body.tester;
  writeDb();
  return stateFor(user);
}, { admin: true });

// Kuvan latauksen vianetsintä: selain kertoo jokaisesta latausyrityksestä, ja tieto kirjoitetaan palvelimen
// lokiin (docker logs gaala | grep kuvalataus). Ei tallenneta tietokantaan.
const uploadLogTimes = new Map(); // käyttäjä → viimeisten lokirivien ajat (max 30 / min)
route('POST', '/api/admin/upload-log', ({ user, body }) => {
  const t = Date.now(); const recent = (uploadLogTimes.get(user.id) || []).filter((x) => t - x < 60000);
  if (recent.length >= 30) return { ok: true };
  recent.push(t); uploadLogTimes.set(user.id, recent);
  const f = (k, n = 120) => clean(body[k], n);
  console.log(`[kuvalataus] ${now()} ${user.name}: ${f('result', 20)} | vaihe: ${f('stage', 160)} | tiedosto: "${f('name', 80)}" ${f('type', 40) || '(ei tyyppiä)'} ${Number(body.size) || 0} t | muoto: ${f('kind', 12) || '-'} | mitat: ${f('dims', 30) || '-'} | virhe: ${f('error', 300) || '-'} | selain: ${f('ua', 200)}`);
  return { ok: true };
}); // kaikki kirjautuneet: myös osallistujien kuvaehdotusten ongelmat näkyvät lokissa

// Osallistujan (henkilön) kuva: näkyy kaikissa hänen ehdokaskorteissaan, ellei kortilla ole omaa kuvaa
route('POST', '/api/admin/users/:id/photo', ({ user, params, body }) => {
  const u = db.users[params.id];
  if (!u || u.root) fail(404, 'Osallistujaa ei löydy.');
  const name = saveImage(body.image);
  const version = { id: newId(), personId: u.id, by: user.root ? null : user.id, image: name, crop: null, source: 'admin', createdAt: now() };
  setProfilePhoto(u, version); // vanha kuva jää versioksi
  db.photoSuggestions.push(version);
  writeDb();
  return { ...stateFor(user), notice: `Kuva tallennettu: ${u.name}.` };
}, { admin: true, maxBody: 12 * 1024 * 1024 });

route('DELETE', '/api/admin/users/:id/photo', ({ user, params }) => {
  const u = db.users[params.id];
  if (!u || u.root) fail(404, 'Osallistujaa ei löydy.');
  keepCurrentPhoto(u); // kuva jää versioksi, josta sen saa takaisin
  u.photo = null;
  u.photoCrop = null;
  writeDb();
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/users/:id/crop', ({ user, params, body }) => {
  const u = db.users[params.id];
  if (!u || u.root || !u.photo) fail(404, 'Osallistujalla ei ole kuvaa.');
  u.photoCrop = cleanCrop(body);
  const v = photoVersionOf(u); if (v) v.crop = u.photoCrop;
  writeDb();
  return { ...stateFor(user), notice: 'Rajaus tallennettu.' };
}, { admin: true });

// Osallistujan tilastot: kaikki ehdotukset, äänet, lukitukset ja palautteet aikaleimoineen.
// Äänille aika tallentuu vasta tästä versiosta alkaen (vanhoissa at puuttuu).
route('GET', '/api/admin/users/:id/stats', ({ params }) => {
  const u = db.users[params.id];
  if (!u || u.root) fail(404, 'Osallistujaa ei löydy.');
  const cat = (id) => db.categories.find((c) => c.id === id);
  const nom = (id) => db.nominees.find((n) => n.id === id);
  const catName = (id) => (cat(id) ? cat(id).name : 'poistettu kategoria');
  const fin = db.finalVotes[u.id] || {}; const finAt = (db.finalVoteAt || {})[u.id] || {};
  return {
    name: u.name,
    createdAt: u.createdAt || null,
    lastLogin: u.lastLogin || null,
    locks: Object.entries(u.locked || {}).map(([p, at]) => ({ phase: Number(p), phaseName: PHASES[p], at })),
    categories: db.categories.filter((c) => c.by === u.id).map((c) => ({ name: c.name, description: c.description, at: c.createdAt, editedAt: c.editedAt || null, advanced: !!c.advanced })),
    catVotes: db.catVotes.filter((v) => v.userId === u.id).map((v) => ({ name: catName(v.categoryId), at: v.at || null })),
    nominees: db.nominees.filter((n) => n.by === u.id).map((n) => ({ category: catName(n.categoryId), name: nomName(n), reason: n.reason, at: n.createdAt, editedAt: n.editedAt || null, finalist: !!n.finalist })),
    nomVotes: db.nomVotes.filter((v) => v.userId === u.id && nom(v.nomineeId)).map((v) => { const n = nom(v.nomineeId); return { category: catName(n.categoryId), name: nomName(n), reason: n.reason, at: v.at || null }; }),
    finals: Object.entries(fin).filter(([, nid]) => nom(nid)).map(([cid, nid]) => ({ category: catName(cid), name: nomName(nom(nid)), reason: nom(nid).reason, at: finAt[cid] || null })),
    feedback: (db.feedback || []).filter((f) => f.userId === u.id).map((f) => ({ text: f.text, at: f.createdAt, phase: f.phase || 5 })),
  };
}, { admin: true });

route('DELETE', '/api/admin/users/:id', ({ user, params }) => {
  const u = db.users[params.id];
  if (!u || u.root) fail(404, 'Osallistujaa ei löydy.');
  if (u.id === user.id) fail(400, 'Et voi poistaa itseäsi.');
  deleteImage(u.photo);
  for (const x of (db.photoSuggestions || []).filter((y) => y.personId === u.id)) deleteImage(x.image);
  db.photoSuggestions = (db.photoSuggestions || []).filter((y) => y.personId !== u.id);
  delete db.users[u.id];
  db.catVotes = db.catVotes.filter((v) => v.userId !== u.id);
  db.nomVotes = db.nomVotes.filter((v) => v.userId !== u.id);
  delete db.finalVotes[u.id];
  if (db.finalVoteAt) delete db.finalVoteAt[u.id];
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
  if (db.settings.phase !== phase) db.settings.nextStart = ''; // vanha "seuraava vaihe alkaa" -aika ei enää päde
  db.settings.phase = phase;
  writeDb();
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/settings', ({ user, body }) => {
  const s = db.settings;
  if ('deadline' in body) s.deadline = clean(body.deadline, 80);
  if ('nextStart' in body) s.nextStart = clean(body.nextStart, 80);
  if ('safeMode' in body) s.safeMode = !!body.safeMode;
  if (body.phaseEnds && typeof body.phaseEnds === 'object') {
    const ends = {};
    for (const p of [1, 2, 3, 4]) {
      const v = String(body.phaseEnds[p] ?? '').trim();
      if (!v) continue;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(400, `Vaiheen ${p} päättymisaika on virheellinen.`);
      ends[p] = v;
    }
    s.phaseEnds = ends;
  }
  for (const k of ['targetCategories', 'catVotes', 'votesP2', 'maxCategoryProposals', 'maxNomineeProposals', 'finalists']) {
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
  applyCategoryEdit(cat, body);
  writeDb();
  return stateFor(user);
}, { admin: true });

route('DELETE', '/api/admin/categories/:id', ({ user, params }) => {
  const cat = db.categories.find((c) => c.id === params.id) || fail(404, 'Kategoriaa ei löydy.');
  if (cat.fixed) fail(400, 'Kiinteää kategoriaa ei voi poistaa.');
  removeCategory(cat);
  writeDb();
  return stateFor(user);
}, { admin: true });

// Valitse jokaiseen kategoriaan N eniten ääniä saanutta finalistiksi (N = asetus finalists)
route('POST', '/api/admin/nominees/auto-finalists', ({ user }) => {
  const counts = countBy(db.nomVotes, 'nomineeId');
  const n = db.settings.finalists; const ties = [];
  for (const c of advancedCats()) {
    const ranked = db.nominees.filter((x) => x.categoryId === c.id)
      .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.createdAt.localeCompare(b.createdAt));
    ranked.forEach((x, i) => {
      x.finalist = i < n;
      if (!x.finalist) for (const fv of Object.values(db.finalVotes)) if (fv[c.id] === x.id) delete fv[c.id];
    });
    const cutoff = counts[ranked[n - 1]?.id] || 0;
    if (ranked.length > n && cutoff > 0 && (counts[ranked[n]?.id] || 0) === cutoff) ties.push(c.name);
  }
  writeDb();
  return { ...stateFor(user), notice: ties.length ? `Valittu ${n} eniten ääniä saanutta per kategoria. Tasapeli viimeisellä paikalla: ${ties.join(', ')} – tarkista.` : `Valittu ${n} eniten ääniä saanutta per kategoria.` };
}, { admin: true });

route('POST', '/api/admin/nominees/:id', ({ user, params, body }) => {
  const nom = db.nominees.find((n) => n.id === params.id) || fail(404, 'Ehdokasta ei löydy.');
  if ('finalist' in body) {
    nom.finalist = !!body.finalist;
    if (!nom.finalist) for (const fv of Object.values(db.finalVotes)) if (fv[nom.categoryId] === nom.id) delete fv[nom.categoryId];
  }
  if ('name' in body || 'reason' in body || 'personId' in body) applyNomineeEdit(nom, body);
  writeDb();
  return stateFor(user);
}, { admin: true });

// Ehdokaskortin oma kuva (korvaa henkilön kuvan tässä kortissa)
route('POST', '/api/admin/nominees/:id/photo', ({ user, params, body }) => {
  const nom = db.nominees.find((n) => n.id === params.id) || fail(404, 'Ehdokasta ei löydy.');
  const name = saveImage(body.image);
  deleteImage(nom.photo);
  nom.photo = name;
  nom.crop = null;
  writeDb();
  return { ...stateFor(user), notice: 'Ehdokaskortin kuva tallennettu.' };
}, { admin: true, maxBody: 12 * 1024 * 1024 });

// Kortin rajaus koskee kortilla näkyvää kuvaa (oma kuva tai henkilön kuva)
route('POST', '/api/admin/nominees/:id/crop', ({ user, params, body }) => {
  const nom = db.nominees.find((n) => n.id === params.id) || fail(404, 'Ehdokasta ei löydy.');
  if (!nomPhoto(nom)) fail(404, 'Kortilla ei ole kuvaa.');
  nom.crop = cleanCrop(body);
  writeDb();
  return { ...stateFor(user), notice: 'Rajaus tallennettu.' };
}, { admin: true });

route('DELETE', '/api/admin/nominees/:id/photo', ({ user, params }) => {
  const nom = db.nominees.find((n) => n.id === params.id) || fail(404, 'Ehdokasta ei löydy.');
  deleteImage(nom.photo);
  nom.photo = null;
  nom.crop = null;
  writeDb();
  return stateFor(user);
}, { admin: true });

route('DELETE', '/api/admin/nominees/:id', ({ user, params }) => {
  const nom = db.nominees.find((n) => n.id === params.id) || fail(404, 'Ehdokasta ei löydy.');
  removeNominee(nom);
  writeDb();
  return stateFor(user);
}, { admin: true });

function requireVoter(user) {
  if (user.root) fail(403, 'Ylläpitotunnuksella ei voi ehdottaa eikä äänestää. Kirjaudu omalla henkilökohtaisella koodillasi.');
  // Testikäyttäjän toiminnot tapahtuvat vain hänen selaimessaan; palvelin ei tallenna mitään
  if (user.tester) fail(403, 'Testikäyttäjä: muutoksia ei tallenneta.');
}

// Muokkaukset: samat säännöt kuin uutta ehdotusta tehdessä (pituus, ei kaksoiskappaleita)
function applyCategoryEdit(cat, body) {
  if ('name' in body) {
    const name = clean(body.name, 60);
    if (name.length < 3) fail(400, 'Kategorian nimi on liian lyhyt.');
    if (db.categories.some((c) => c.id !== cat.id && norm(c.name) === norm(name))) fail(409, 'Samanniminen kategoria on jo olemassa.');
    cat.name = name;
  }
  if ('description' in body) cat.description = clean(body.description, 160);
  cat.editedAt = now();
}

function applyNomineeEdit(nom, body) {
  // Henkilön voi vaihtaa korttien henkilöihin; vanhat vapaalla nimellä tehdyt ehdokkaat voi nimetä uudelleen
  let personId = nom.personId || null; let name = nom.name;
  if (body.personId) {
    const person = db.users[body.personId];
    if (!person || person.root) fail(404, 'Henkilöä ei löydy.');
    personId = person.id; name = person.name;
  } else if ('name' in body && !personId) {
    name = clean(body.name, 60);
  }
  const reason = 'reason' in body ? clean(body.reason, 160) : nom.reason;
  if (name.length < 2) fail(400, 'Kirjoita ehdokkaan nimi.');
  if (reason.length < 3) fail(400, 'Kirjoita myös mistä ehdotat.');
  const same = (n) => (personId ? n.personId === personId : !n.personId && norm(n.name) === norm(name));
  if (db.nominees.some((n) => n.id !== nom.id && n.categoryId === nom.categoryId && same(n) && norm(n.reason) === norm(reason))) fail(409, 'Sama ehdotus on jo listalla.');
  nom.personId = personId;
  nom.name = name;
  nom.reason = reason;
  nom.editedAt = now();
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
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

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

  if (pathname.startsWith('/images/')) return serveImage(req, res, pathname);
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
    const body = req.method === 'GET' ? {} : await readBody(req, r.maxBody);
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
