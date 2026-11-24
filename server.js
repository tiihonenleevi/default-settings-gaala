// HerrasmiesKlubi Gaala – äänestyspalvelin
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
const VIDEO_DIR = path.join(DATA_DIR, 'videos'); // videoklipit (vain adminit näkevät toistaiseksi)

if (!ADMIN_CODE || ADMIN_CODE.length < 8) {
  console.error('Aseta ADMIN_CODE, vähintään 8 merkkiä (.env-tiedostoon tai ympäristömuuttujiin).');
  process.exit(1);
}

const FIXED_CATEGORY = { name: 'Vuoden sykähdyttävin hetki', description: 'Hetki, joka jäi kaikkien mieleen.' };
// Vaiheet: 1 = kategorioiden ehdottaminen, 2 = äänestys gaalaan pääsevistä kategorioista,
// 3 = ehdokkaiden ehdottaminen, 4 = ehdokasäänestys (sijat 1.–3. per kategoria), 5 = finaali, 6 = suljettu
const PHASES = { 1: 'Kategoriaehdotukset', 2: 'Kategoria-äänestys', 3: 'Ehdokasehdotukset', 4: 'Ehdokasäänestys', 5: 'Finaali', 6: 'Suljettu' };
const LAST_OPEN = 5; // viimeinen vaihe, jossa äänestetään ja lukitaan (6 = suljettu)
// Ehdokasäänestys: jokainen asettaa kussakin kategoriassa sijat 1.–3.; 1. sija = 3 p, 2. = 2 p, 3. = 1 p
const RANK_SLOTS = 3;
const RANK_POINTS = [3, 2, 1];

// ---------- Tietokanta (JSON-tiedosto) ----------
let db = loadDb();

function emptyDb() {
  const fixedId = newId();
  return {
    settings: {
      phase: 1,
      deadline: '',
      nextStart: '', // milloin seuraava vaihe alkaa (näkyy odotusnäytöllä); tyhjenee vaiheen vaihtuessa
      phaseEnds: {}, // vaiheiden 1–5 päättymisajat muodossa "2026-12-04T20:00" (näkyvät vaihepalkissa)
      targetCategories: 8, // kategorioita gaalassa (sis. kiinteät); äänestyksellä valitaan tämä − kiinteät
      catVotes: 3, // ääniä per henkilö kategoria-äänestyksessä (vaihe 2)
      maxCategoryProposals: 3, // kategoriaehdotuksia per henkilö
      maxNomineeProposals: 2, // ehdokasehdotuksia per henkilö per kategoria
      finalists: 3, // automaattisesti valittavia finalisteja per kategoria
      phaseScheme: 3, // vaiheiden numerointi (3 = kuusi vaihetta, ehdokasäänestys omana vaiheenaan)
    },
    users: {},
    categories: [{ id: fixedId, name: FIXED_CATEGORY.name, description: FIXED_CATEGORY.description, fixed: true, advanced: true, by: null, createdAt: now() }],
    catVotes: [],
    nominees: [],
    nomRanks: {}, // ehdokasäänestys (vaihe 4): { userId: { categoryId: [1. sija, 2. sija, 3. sija] } } (tyhjä paikka = null)
    nomRankAt: {}, // milloin kategorian sijoitusta viimeksi muutettiin: { userId: { categoryId: aikaleima } }
    finalVotes: {},
    finalVoteAt: {}, // milloin finaaliääni annettiin: { userId: { categoryId: aikaleima } }
    feedback: [], // palautteet: { id, userId, phase, text, createdAt }; phase 1–5 = odotustila lukituksen jälkeen, 6 = suljettu
    // Profiilikuvien versiot: kaikki ehdotetut, adminin lisäämät ja aiemmat kuvat säilyvät, ja admin voi vaihtaa niiden välillä.
    // { id, personId, by, image, crop, source: 'suggestion' | 'admin' | 'previous', withdrawn, createdAt }
    photoSuggestions: [],
    // Hall of Fame: aiempien vuosien gaalat. { id, year, categories: [{ name, description, nominees: [{ name, reason, personId, winner }] }] }
    hallOfFame: [],
    // Videot: { id, personId, title, by, createdAt, status: 'processing' | 'ready' | 'failed', file, poster, duration, width, height, size, error }
    videos: [],
  };
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
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
  // Viisivaiheinen versio (3 ehdokkaat + äänestys, 4 finaali, 5 suljettu) → kuusi vaihetta: ehdokasäänestys on nyt
  // oma vaiheensa 4, joten finaali siirtyy vaiheeksi 5 ja suljettu 6:ksi. Vanhan ehdokasvaiheen äänet poistetaan
  // (ehdotusvaiheessa ei enää äänestetä). Lukitukset, avauspyynnöt, palautteet ja päättymisajat siirtyvät mukana.
  if (st.phaseScheme === 2) {
    const shift = (p) => (Number(p) >= 4 ? Number(p) + 1 : Number(p));
    const shiftKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [shift(k), v]));
    if (st.phase >= 4) st.phase += 1;
    st.phaseEnds = shiftKeys(st.phaseEnds);
    for (const u of Object.values(data.users || {})) {
      if (u.locked) u.locked = shiftKeys(u.locked);
      if (u.unlockRequest) u.unlockRequest = shiftKeys(u.unlockRequest);
    }
    for (const f of data.feedback || []) f.phase = shift(f.phase || 5);
    delete st.votesP2;
    st.phaseScheme = 3;
  }
  delete data.nomVotes;
  data.nomRanks = data.nomRanks || {};
  data.nomRankAt = data.nomRankAt || {};
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

// ---------- Videot (vain adminit, testivaihe) ----------
// Puhelimen tai tietokoneen video lähetetään raakana tiedostona (ei JSONina/base64:nä), ja palvelin kirjoittaa sen
// suoraan levylle, joten isokaan video ei täytä muistia. Jos ffmpeg on asennettu (Dockerfile asentaa sen), video
// muunnetaan taustalla muotoon, joka toimii kaikissa selaimissa: H.264 + AAC MP4, pidempi sivu enintään
// VIDEO_MAX_SIDE px, enintään 30 kuvaa/s. iPhonen HDR-video (HLG/Dolby Vision) muunnetaan tavalliseksi, jottei se
// näytä haalealta, ja sijaintitiedot (GPS) yms. metatiedot poistetaan. Videosta otetaan myös kansikuva korttiin.
// Ilman ffmpegiä alkuperäinen tiedosto tallennetaan sellaisenaan (iPhonen HEVC-video ei silloin toistu kaikissa selaimissa).
const { execFile, spawn } = require('node:child_process');
const os = require('node:os');
const VIDEO_MAX_MB = Math.max(10, Number(process.env.VIDEO_MAX_MB || 500));
const VIDEO_MAX_SIDE = Math.max(320, Number(process.env.VIDEO_MAX_SIDE || 1280));
const VIDEO_NAME = /^[0-9a-f]{16}\.(mp4|mov|webm|jpg)$/;
const VIDEO_MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.jpg': 'image/jpeg' };
let ffmpegOk = null; // null = tarkistamatta, true/false = löytyikö ffmpeg
let videoJob = null; // { id, child } käynnissä oleva muunnos
const videoQueue = [];
const vpath = (name) => path.join(VIDEO_DIR, name);
const rmVideoFile = (name) => { if (name) fs.rm(vpath(name), { force: true }, () => {}); };

// Ehdokasvideon henkilö seuraa ehdokasta (ehdokkaan henkilöä voi muokata)
const videoNominee = (v) => (v.nomineeId ? db.nominees.find((n) => n.id === v.nomineeId) : null);
function videoView(v) {
  const nom = videoNominee(v);
  const personId = nom ? nom.personId : v.personId;
  return {
    id: v.id, personId, personName: nom ? nomName(nom) : userName(personId), title: v.title || '', status: v.status, error: v.error || '',
    nominee: nom ? { id: nom.id, category: (db.categories.find((c) => c.id === nom.categoryId) || {}).name || '', reason: nom.reason } : null,
    src: v.file ? `/videos/${v.file}` : null, poster: v.poster ? `/videos/${v.poster}` : null,
    duration: v.duration || null, width: v.width || null, height: v.height || null, size: v.size || null,
    byName: v.by ? userName(v.by) : '', createdAt: v.createdAt,
  };
}

// Ehdokkaan video selaimelle (kaikki kirjautuneet näkevät ehdokkaiden videot)
function nomVideo(n) {
  const v = n.videoId && (db.videos || []).find((x) => x.id === n.videoId);
  if (!v) return null;
  return { id: v.id, status: v.status, src: v.file ? `/videos/${v.file}` : null, poster: v.poster ? `/videos/${v.poster}` : null, duration: v.duration || null };
}

// Tiedoston alku kertoo säiliön: MP4/MOV (iPhone, Android, useimmat) tai WebM/MKV
function sniffVideo(file) {
  const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(16);
  try { fs.readSync(fd, b, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (b.toString('latin1', 4, 8) === 'ftyp') return b.toString('latin1', 8, 12) === 'qt  ' ? 'mov' : 'mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return null;
}

function run(cmd, args, timeoutMs, onChild) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(child.pid, 10); } catch {} // muunnos ei hidasta itse sivua
    if (onChild) onChild(child);
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { if (out.length < 200000) out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code, sig) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(sig ? `keskeytetty (${sig})` : err.trim().split('\n').slice(-3).join(' | ') || `exit ${code}`)); });
  });
}

async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], 60000);
  const j = JSON.parse(out);
  const vs = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const rot = Number(((vs && vs.side_data_list) || []).find((x) => x.rotation != null)?.rotation || (vs && vs.tags && vs.tags.rotate) || 0);
  const [fn, fd] = String((vs && (vs.avg_frame_rate || vs.r_frame_rate)) || '0/1').split('/').map(Number);
  const swap = Math.abs(rot) % 180 === 90;
  return {
    video: !!vs, duration: Number(j.format && j.format.duration) || Number(vs && vs.duration) || 0,
    width: vs ? (swap ? vs.height : vs.width) : 0, height: vs ? (swap ? vs.width : vs.height) : 0,
    fps: fd ? fn / fd : 0, hdr: !!vs && ['arib-std-b67', 'smpte2084'].includes(vs.color_transfer),
  };
}

async function processVideo(v) {
  const src = vpath(`${v.id}.orig`); const tmp = vpath(`${v.id}.tmp.mp4`); const out = `${v.id}.mp4`; const poster = `${v.id}.jpg`;
  const info = await probe(src);
  if (!info.video) throw new Error('Tiedostossa ei ole videokuvaa.');
  const scale = `scale=w='min(iw,${VIDEO_MAX_SIDE})':h='min(ih,${VIDEO_MAX_SIDE})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const fps = info.fps > 31 ? ',fps=30' : '';
  const tonemap = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,';
  const encode = (vf) => run('ffmpeg', ['-hide_banner', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1',
    '-vf', `${vf}format=yuv420p,${scale}${fps}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', tmp], 60 * 60 * 1000, (child) => { videoJob = { id: v.id, child }; });
  try { await encode(info.hdr ? tonemap : ''); } catch (e) {
    if (!info.hdr || !db.videos.some((x) => x.id === v.id)) throw e;
    await encode(''); // HDR-muunnos ei onnistunut (esim. zscale puuttuu): tavallinen muunnos, värit voivat olla haaleat
  }
  const done = await probe(tmp);
  const at = Math.min(1, (done.duration || 0) / 2).toFixed(2);
  await run('ffmpeg', ['-hide_banner', '-y', '-ss', at, '-i', tmp, '-frames:v', '1', '-vf', 'scale=w=640:h=640:force_original_aspect_ratio=decrease', '-q:v', '4', vpath(poster)], 120000)
    .catch(() => {});
  fs.renameSync(tmp, vpath(out));
  return { file: out, poster: fs.existsSync(vpath(poster)) ? poster : null, duration: done.duration, width: done.width, height: done.height, size: fs.statSync(vpath(out)).size };
}

// Ilman ffmpegiä: alkuperäinen tiedosto sellaisenaan
function keepOriginal(v) {
  const kind = sniffVideo(vpath(`${v.id}.orig`)) || 'mp4';
  const file = `${v.id}.${kind}`;
  fs.renameSync(vpath(`${v.id}.orig`), vpath(file));
  Object.assign(v, { status: 'ready', file, poster: null, size: fs.statSync(vpath(file)).size });
}

async function runVideoQueue() {
  if (videoJob || ffmpegOk === null) return;
  const id = videoQueue.shift(); if (!id) return;
  const v = db.videos.find((x) => x.id === id);
  if (!v || v.status !== 'processing') return runVideoQueue();
  videoJob = { id, child: null };
  const started = Date.now();
  try {
    if (!ffmpegOk) keepOriginal(v);
    else {
      const r = await processVideo(v);
      const still = db.videos.find((x) => x.id === id);
      if (!still) { rmVideoFile(r.file); rmVideoFile(r.poster); } // poistettiin muunnoksen aikana
      else { Object.assign(still, r, { status: 'ready', error: '' }); console.log(`Video ${id} valmis ${Math.round((Date.now() - started) / 1000)} s`); }
      rmVideoFile(`${id}.orig`);
    }
  } catch (e) {
    const still = db.videos.find((x) => x.id === id);
    rmVideoFile(`${id}.orig`); rmVideoFile(`${id}.tmp.mp4`);
    if (still) {
      still.status = 'failed';
      still.error = /videokuvaa/.test(e.message) ? e.message : 'Videota ei voitu muuntaa. Onko tiedosto ehjä video?';
      console.error(`Video ${id} epäonnistui:`, e.message);
      notify('errors', `🛑 **Videon muunnos epäonnistui** (${videoView(still).personName || 'ehdotusluonnos, ' + userName(still.by)})\n${String(e.message).slice(0, 300)}`);
    }
  } finally {
    videoJob = null;
    writeDb();
    runVideoQueue();
  }
}
function enqueueVideo(id) { if (!videoQueue.includes(id)) videoQueue.push(id); runVideoQueue(); }

// Käynnistyksessä: löytyykö ffmpeg, ja jatketaan kesken jääneitä muunnoksia
function initVideos() {
  db.videos = db.videos || [];
  // Keskeytyneiden lähetysten ja muunnosten jäänteet pois
  try { for (const f of fs.readdirSync(VIDEO_DIR)) if (/\.(upload|tmp\.mp4)$/.test(f)) rmVideoFile(f); } catch {}
  execFile('ffmpeg', ['-hide_banner', '-version'], (e1) => execFile('ffprobe', ['-version'], (e2) => {
    ffmpegOk = !e1 && !e2;
    console.log(ffmpegOk ? 'ffmpeg löytyi: videot muunnetaan MP4-muotoon.' : 'ffmpeg puuttuu: videot tallennetaan sellaisenaan (asenna ffmpeg Dockerfilessä).');
    for (const v of db.videos.filter((x) => x.status === 'processing')) {
      if (fs.existsSync(vpath(`${v.id}.orig`))) videoQueue.push(v.id);
      else { v.status = 'failed'; v.error = 'Lähetys keskeytyi. Lähetä video uudelleen.'; }
    }
    cleanDrafts();
    writeDb();
    runVideoQueue();
  }));
  setInterval(cleanDrafts, 60 * 60 * 1000).unref();
}

// Lähetys, runko on itse videotiedosto:
//  - POST /api/admin/videos/upload?personId=…&title=… – admin lisää videon osallistujalle (Videot-sivu)
//  - POST /api/videos/upload?categoryId=… – osallistuja liittää videon ehdokasehdotukseen (vaihe 3). Video on
//    luonnos, kunnes ehdotus lähetetään (POST /api/nominees, videoId). Liittämättömät luonnokset poistetaan.
// CSRF: vaaditaan oma otsake X-Gaala-Upload, jota toinen sivusto ei voi lähettää ilman CORS-lupaa.
const DRAFT_MAX = 4; // liittämättömiä luonnoksia per osallistuja (vanhin poistuu)
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
function handleVideoUpload(req, res, url, mode) {
  const reject = (status, error) => { send(res, status, { error }); req.resume(); };
  const user = currentUser(req);
  if (!user) return reject(401, 'Kirjaudu ensin sisään.');
  if (req.headers['x-gaala-upload'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') return reject(403, 'Estetty pyyntö.');
  let person = null; let cat = null;
  if (mode === 'admin') {
    if (!user.admin) return reject(403, 'Vain adminille.');
    person = db.users[url.searchParams.get('personId') || ''];
    if (!person || person.root) return reject(404, 'Osallistujaa ei löydy.');
  } else {
    if (db.settings.phase !== 3) return reject(409, 'Videon voi liittää ehdotukseen vain ehdokasehdotusvaiheessa.');
    if (user.root || user.tester) return reject(403, 'Testikäyttäjän video kokeillaan vain omassa selaimessa.');
    if (isLocked(user)) return reject(409, 'Olet jo lyönyt vastauksesi lukkoon.');
    cat = advancedCats().find((c) => c.id === url.searchParams.get('categoryId'));
    if (!cat) return reject(404, 'Kategoriaa ei löydy.');
  }
  const max = VIDEO_MAX_MB * 1024 * 1024;
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > max) return reject(413, `Video on liian suuri (max ${VIDEO_MAX_MB} Mt).`);
  try {
    const free = fs.statfsSync(VIDEO_DIR); const avail = free.bavail * free.bsize;
    if (declared && avail < declared * 2 + 300 * 1024 * 1024) return reject(507, 'Palvelimen levytila ei riitä videolle.');
  } catch { /* statfs puuttuu vanhasta Nodesta: ei tarkistusta */ }
  const id = newId(); const tmp = vpath(`${id}.upload`);
  const out = fs.createWriteStream(tmp);
  let size = 0; let aborted = false;
  const abort = (status, msg) => {
    if (aborted) return; aborted = true;
    out.once('close', () => rmVideoFile(`${id}.upload`)); out.destroy(); // poisto vasta kun tiedosto on suljettu
    if (!res.headersSent) send(res, status, { error: msg });
    req.unpipe(out); req.resume();
  };
  req.on('data', (c) => { size += c.length; if (size > max) abort(413, `Video on liian suuri (max ${VIDEO_MAX_MB} Mt).`); });
  req.on('close', () => { if (!req.complete) abort(400, 'Lähetys keskeytyi.'); });
  out.on('error', () => abort(500, 'Videon tallennus epäonnistui.'));
  req.pipe(out);
  out.on('finish', () => {
    if (aborted) return;
    if (size < 1000) { rmVideoFile(`${id}.upload`); return send(res, 400, { error: 'Tiedosto on tyhjä.' }); }
    const kind = sniffVideo(tmp);
    if (!kind) {
      rmVideoFile(`${id}.upload`);
      notify('errors', `🛑 **Videon lähetys hylättiin** (${user.name}${person ? ' → ' + person.name : ', ehdotus: ' + cat.name}): tuntematon tiedostomuoto`);
      return send(res, 400, { error: 'Tiedosto ei ole tuettu video (MP4, MOV tai WebM).' });
    }
    fs.renameSync(tmp, vpath(`${id}.orig`));
    if (person) {
      db.videos.push({ id, personId: person.id, title: clean(url.searchParams.get('title'), 80), by: user.id, createdAt: now(), status: 'processing', size, kind });
      writeDb();
      enqueueVideo(id);
      return send(res, 200, { ...stateFor(user), notice: ffmpegOk ? 'Video lähetetty. Palvelin käsittelee sen hetken.' : 'Video lähetetty.' });
    }
    // Luonnos: vanhimmat liittämättömät saman käyttäjän luonnokset pois, jos niitä on liikaa
    const drafts = db.videos.filter((v) => v.draft && v.by === user.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const d of drafts.slice(0, Math.max(0, drafts.length - (DRAFT_MAX - 1)))) deleteVideo(d);
    db.videos.push({ id, personId: null, draft: true, categoryId: cat.id, title: '', by: user.id, createdAt: now(), status: 'processing', size, kind });
    writeDb();
    enqueueVideo(id);
    send(res, 200, { videoId: id });
  });
}

// Videot ja kansikuvat. Admin näkee kaikki; ehdokkaaseen liitetyn videon näkevät kaikki kirjautuneet; luonnoksen
// vain lähettäjä; adminin Videot-sivun videot vain adminit. Range-tuki on pakollinen iPhonen Safarille ja kelaukselle.
function videoAllowed(user, name) {
  if (!user || !VIDEO_NAME.test(name)) return false;
  if (user.admin) return true;
  const v = (db.videos || []).find((x) => x.file === name || x.poster === name);
  if (!v) return false;
  if (v.draft) return v.by === user.id;
  return !!videoNominee(v);
}
function serveVideo(req, res, pathname) {
  const name = pathname.slice('/videos/'.length);
  const user = currentUser(req);
  if (!videoAllowed(user, name)) { res.writeHead(404); return res.end(); }
  const file = vpath(name);
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404); return res.end(); }
    const headers = { 'Content-Type': VIDEO_MIME[path.extname(name)], 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable' };
    let start = 0; let end = st.size - 1; let status = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      if (m[1] === '') start = Math.max(0, st.size - Number(m[2]));
      else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

function deleteVideo(v) {
  if (videoJob && videoJob.id === v.id && videoJob.child) videoJob.child.kill('SIGKILL');
  for (const n of [v.file, v.poster, `${v.id}.orig`, `${v.id}.upload`, `${v.id}.tmp.mp4`]) rmVideoFile(n);
  db.videos = db.videos.filter((x) => x.id !== v.id);
  for (const n of db.nominees) if (n.videoId === v.id) delete n.videoId;
}
// Liittämättömät, vanhat luonnokset pois (tunnin välein ja käynnistyksessä)
function cleanDrafts() {
  const limit = new Date(Date.now() - DRAFT_TTL_MS).toISOString();
  const old = (db.videos || []).filter((v) => v.draft && v.createdAt < limit);
  if (!old.length) return;
  old.forEach(deleteVideo);
  writeDb();
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

// Ehdokasäänestyksen sijat: montako sijaa kategoriassa jaetaan (3, tai vähemmän jos ehdokkaita on vähemmän)
const rankSlots = (catId) => Math.min(RANK_SLOTS, db.nominees.filter((n) => n.categoryId === catId).length);
// Käyttäjän sijoitus kategoriassa: vain voimassa olevat paikat (1..rankSlots), poistetut ehdokkaat tyhjinä
function myRanking(uid, catId) {
  const slots = rankSlots(catId);
  const ids = new Set(db.nominees.filter((n) => n.categoryId === catId).map((n) => n.id));
  const arr = ((db.nomRanks[uid] || {})[catId] || []).slice(0, slots).map((id) => (ids.has(id) ? id : null));
  while (arr.length < slots) arr.push(null);
  return arr;
}
// Ehdokasäänestyksen vaatimus lukitukseen: jokaisessa kategoriassa kaikki sijat jaettu
function rankNeed(uid) {
  return advancedCats().map((c) => {
    const need = rankSlots(c.id);
    const have = uid ? myRanking(uid, c.id).filter(Boolean).length : 0;
    return { cat: c, need, have };
  });
}
// Pisteet ja sijajakauma per ehdokas: { nomineeId: { points, places: [1. sijat, 2. sijat, 3. sijat], voters: [{ userId, place }] } }
function rankScores() {
  const m = {};
  for (const [uid, cats] of Object.entries(db.nomRanks || {})) {
    if (!db.users[uid]) continue;
    for (const cid of Object.keys(cats)) {
      myRanking(uid, cid).forEach((nid, i) => {
        if (!nid) return;
        const x = (m[nid] = m[nid] || { points: 0, places: [0, 0, 0], voters: [] });
        x.points += RANK_POINTS[i]; x.places[i] += 1; x.voters.push({ userId: uid, place: i + 1 });
      });
    }
  }
  return m;
}

// Voiko osallistuja lukita tämän vaiheen? Sama tarkistus palvelimella ja napissa.
function lockReady(user) {
  const p = db.settings.phase; const uid = user.id;
  if (p === 2 && !db.catVotes.some((v) => v.userId === uid)) return { ok: false, reason: 'Äänestä vähintään yhtä kategoriaa ennen lukitsemista.' };
  if (p === 4) {
    const missing = rankNeed(uid).filter((x) => x.have < x.need);
    if (missing.length) return { ok: false, reason: `Jaa kaikki sijat ennen lukitsemista. Puuttuu: ${missing.map((x) => `${x.cat.name} (${x.have}/${x.need})`).join(', ')}.` };
  }
  if (p === 5 && !Object.keys(db.finalVotes[uid] || {}).length) return { ok: false, reason: 'Äänestä vähintään yhtä finalistia ennen lukitsemista.' };
  return { ok: true, reason: '' };
}

function removeCategory(cat) {
  const doomed = db.nominees.filter((n) => n.categoryId === cat.id);
  const nomIds = new Set(doomed.map((n) => n.id));
  doomed.forEach((n) => { deleteImage(n.photo); const vid = n.videoId && (db.videos || []).find((v) => v.id === n.videoId); if (vid) deleteVideo(vid); });
  db.categories = db.categories.filter((c) => c.id !== cat.id);
  db.catVotes = db.catVotes.filter((v) => v.categoryId !== cat.id);
  db.nominees = db.nominees.filter((n) => !nomIds.has(n.id));
  for (const r of Object.values(db.nomRanks)) delete r[cat.id];
  for (const r of Object.values(db.nomRankAt)) delete r[cat.id];
  for (const fv of Object.values(db.finalVotes)) delete fv[cat.id];
}

function removeNominee(nom) {
  deleteImage(nom.photo);
  const vid = nom.videoId && (db.videos || []).find((v) => v.id === nom.videoId);
  if (vid) deleteVideo(vid);
  db.nominees = db.nominees.filter((n) => n.id !== nom.id);
  // Poistetun ehdokkaan sija vapautuu (muut sijat pysyvät paikoillaan)
  for (const r of Object.values(db.nomRanks)) if (r[nom.categoryId]) r[nom.categoryId] = r[nom.categoryId].map((id) => (id === nom.id ? null : id));
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
    limits: { targetCategories: s.targetCategories, fixedCategories: fixedCount(), advanceCount: advanceCount(), catVotes: s.catVotes, rankSlots: RANK_SLOTS, rankPoints: RANK_POINTS, finalists: s.finalists, maxCategoryProposals: s.maxCategoryProposals, maxNomineeProposals: s.maxNomineeProposals, videoMaxMb: VIDEO_MAX_MB },
    me: user ? { name: user.name, admin: !!user.admin, root: !!user.root, tester: !!user.tester, locked: user.tester ? false : isLocked(user), unlockRequested: unlockRequested(user), photo: displayPhoto(user) } : null,
  };
  if (!user) return base;
  const uid = user.id;

  const myCatVotes = new Set(db.catVotes.filter((v) => v.userId === uid).map((v) => v.categoryId));
  const myFinal = db.finalVotes[uid] || {};

  const visibleCats = phase <= 2 ? db.categories : advancedCats();
  base.categories = visibleCats.map((c) => ({
    id: c.id, name: c.name, description: c.description, fixed: !!c.fixed, advanced: !!c.advanced, videoRequired: !!c.videoRequired,
    mine: c.by === uid, myVote: myCatVotes.has(c.id),
  }));

  const visibleNoms = phase === 3 || phase === 4
    ? db.nominees.filter((n) => advancedCats().some((c) => c.id === n.categoryId))
    : phase >= 5 ? db.nominees.filter((n) => n.finalist) : [];
  base.nominees = visibleNoms.map((n) => ({
    id: n.id, categoryId: n.categoryId, personId: n.personId || null, name: nomName(n), reason: n.reason, photo: nomPhoto(n), finalist: !!n.finalist,
    mine: n.by === uid, myFinal: myFinal[n.categoryId] === n.id, video: nomVideo(n),
  }));
  // Oma ehdokasäänestys: { categoryId: [1., 2., 3. sija] } (vain gaalaan päässeet kategoriat)
  base.myRanks = Object.fromEntries(advancedCats().map((c) => [c.id, myRanking(uid, c.id)]));
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
  if (phase === 6 || isLocked(user) || user.tester) {
    base.feedback = (db.feedback || []).filter((f) => (f.phase || 6) === phase).map((f) => ({ id: f.id, text: f.text, createdAt: f.createdAt, mine: f.userId === uid }));
  }

  base.used = {
    catVotes: myCatVotes.size,
    catProposals: db.categories.filter((c) => c.by === uid).length,
  };
  // Testikäyttäjän lukitusehdot lasketaan selaimessa paikallisen kokeilun mukaan
  base.lockReady = user.root || user.tester ? { ok: !user.root, reason: '' } : lockReady(user);


  // Hall of Fame näkyy muille vasta, kun admin on julkaissut sen; adminit näkevät sen aina (keskeneräisenä)
  base.hallOfFame = db.settings.hofPublished || user.admin ? hofView() : [];

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
  const scores = rankScores();
  const fin = finalCounts();
  const showVoters = db.settings.phase >= 4;
  return {
    participants: Object.values(db.users).filter((u) => !u.root).map((u) => ({
      id: u.id, name: u.name, code: fmtCode(u.code), admin: !!u.admin, joined: !!u.lastLogin, photo: photoOf(u.photo, u.photoCrop), safePhoto: photoOf(u.safePhoto, u.safePhotoCrop), shownPhoto: displayPhoto(u), nominable: u.nominable !== false, tester: !!u.tester,
      p1: db.categories.filter((c) => c.by === u.id).length,
      p2: db.catVotes.filter((v) => v.userId === u.id).length,
      p3: db.nominees.filter((n) => n.by === u.id).length,
      p4: rankNeed(u.id).filter((x) => x.need > 0 && x.have >= x.need).length,
      p5: Object.keys(db.finalVotes[u.id] || {}).length,
      locked: isLocked(u), unlockRequested: unlockRequested(u),
    })).sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    categories: db.categories.map((c) => ({ id: c.id, name: c.name, description: c.description, fixed: !!c.fixed, advanced: !!c.advanced, videoRequired: !!c.videoRequired, votes: catCounts[c.id] || 0, byName: userName(c.by) })),
    nominees: db.nominees.map((n) => ({ id: n.id, categoryId: n.categoryId, personId: n.personId || null, name: nomName(n), reason: n.reason, photo: nomPhoto(n), ownPhoto: !!n.photo, finalist: !!n.finalist,
      points: (scores[n.id] || {}).points || 0, places: (scores[n.id] || {}).places || [0, 0, 0],
      rankVoters: showVoters && scores[n.id] ? scores[n.id].voters.map((x) => ({ name: userName(x.userId), place: x.place })).sort((a, b) => a.place - b.place || a.name.localeCompare(b.name, 'fi')) : [],
      finalVotes: fin[n.id] || 0, byName: userName(n.by),
      finalVoters: db.settings.phase >= 5 ? Object.entries(db.finalVotes).filter(([, v]) => v[n.categoryId] === n.id).map(([uid]) => userName(uid) || 'poistettu').sort((a, b) => a.localeCompare(b, 'fi')) : [] })),
    safeMode: !!db.settings.safeMode,
    videos: (db.videos || []).filter((v) => !v.draft && (videoNominee(v) || db.users[v.personId])).map(videoView),
    videoInfo: { ffmpeg: !!ffmpegOk, maxMb: VIDEO_MAX_MB, queue: videoQueue.length + (videoJob ? 1 : 0) },
    hofPublished: !!db.settings.hofPublished,
    awards: awardsAdmin(),
    // Discord-ilmoitukset: osoitetta ei koskaan lähetetä selaimeen, vain tieto siitä, onko se asetettu
    notify: { set: !!webhookUrl(), fromEnv: !db.settings.discordWebhook && !!process.env.DISCORD_WEBHOOK, kinds: Object.fromEntries(Object.keys(NOTIFY_KINDS).map((k) => [k, notifyOn(k)])), reminderTime: reminderTime() },
    bulletin: { set: !!db.settings.publicWebhook, roleId: db.settings.publicRoleId || '', time: bulletinTime(), names: bulletinNamesOn(), skip: [...bulletinSkip()], lastSent: db.settings.bulletinLastSent || '' },
    rankCats: rankNeed(null).filter((x) => x.need > 0).length,
    voters: { p1: new Set(db.categories.filter((c) => c.by).map((c) => c.by)).size, p2: new Set(db.catVotes.map((v) => v.userId)).size, p3: new Set(db.nominees.filter((n) => n.by).map((n) => n.by)).size, p4: Object.keys(db.nomRanks).filter((uid) => db.users[uid] && advancedCats().some((c) => myRanking(uid, c.id).some(Boolean))).length, p5: Object.keys(db.finalVotes).length },
    locked: Object.values(db.users).filter((u) => !u.root && !u.tester && isLocked(u)).length,
    winners: winnersFor(advancedCats().map((c) => c.id)),
    // Palauteloki: vain adminit näkevät kirjoittajan
    feedbackLog: (db.feedback || []).map((f) => ({ id: f.id, phase: f.phase || 6, name: userName(f.userId) || 'Poistettu osallistuja', text: f.text, createdAt: f.createdAt })),
  };
}

// ---------- Hall of Fame ----------
// Aiempien vuosien voittajat ja ehdokkaat. Hall of Famen kuvat ovat omia kuviaan (n.image), eivät osallistujien
// profiilikuvia, joten osallistujan poisto tai profiilikuvan vaihto ei muuta niitä. Alle K18 -tilassa kuvat piilotetaan
// (niille ei ole <18-versiota) ja tilalla näkyy nimikirjain. Nimi tallennetaan erikseen, joten se säilyy aina.
function hofView() {
  return (db.hallOfFame || []).slice().sort((a, b) => b.year - a.year).map((y) => ({
    id: y.id, year: y.year,
    // Vuoden kansikuva otsikon alla (esim. ryhmäkuva gaalasta); Alle K18 -tilassa piilossa kuten muutkin kuvat
    cover: y.cover ? { image: y.cover.image, imageSrc: imgUrl(y.cover.image), crop: y.cover.crop || null, photo: db.settings.safeMode ? null : photoOf(y.cover.image, y.cover.crop) } : null,
    categories: y.categories.map((c) => ({
      name: c.name, description: c.description || '', awardToken: c.awardToken || null,
      nominees: c.nominees.map((n) => ({ name: n.name, reason: n.reason || '', winner: !!n.winner, place: hofPlace(n), personId: n.personId && db.users[n.personId] ? n.personId : null, image: n.image || null, imageSrc: imgUrl(n.image), crop: n.crop || null, photo: db.settings.safeMode ? null : photoOf(n.image, n.crop) })),
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
      const place = [1, 2, 3].includes(Number(n.place)) ? Number(n.place) : (n.winner ? 1 : null);
      nominees.push({ name: nName, reason: clean(n.reason, 160), personId: person ? person.id : null, winner: place === 1, place, image, crop });
    }
    if (!name && !nominees.length) continue;
    if (!name) fail(400, 'Jokaisella kategorialla pitää olla nimi.');
    if (!nominees.length) fail(400, `Lisää kategoriaan "${name}" vähintään yksi ehdokas.`);
    // Palkintosivun linkki (QR-koodi) säilyy muokatessa; uudelle kategorialle luodaan oma
    const token = typeof c.awardToken === 'string' && AWARD_TOKEN_RE.test(c.awardToken) ? c.awardToken : newAwardToken();
    out.push({ name, description: clean(c.description, 200), awardToken: token, nominees });
  }
  if (!out.length) fail(400, 'Lisää vähintään yksi kategoria.');
  return out;
}

// Hall of Famen kuvatiedostot, joita mikään vuosi ei enää käytä, poistetaan levyltä
const hofImages = (entries) => new Set(entries.flatMap((y) => [y.cover && y.cover.image, ...y.categories.flatMap((c) => c.nominees.map((n) => n.image))].filter(Boolean)));

// Kansikuva lomakkeelta: { image, crop } tai null. Kuvan pitää olla ladattu (/api/admin/hof/image).
function cleanHofCover(c) {
  const image = c && typeof c.image === 'string' && IMG_NAME.test(c.image) && fs.existsSync(path.join(IMG_DIR, c.image)) ? c.image : null;
  return image ? { image, crop: c.crop ? cleanCrop(c.crop) : null } : null;
}
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
  if (db.nominees.some((n) => n.categoryId === cat.id && n.personId === person.id && norm(n.reason) === norm(reason))) fail(409, 'Sama ehdotus on jo listalla.');
  const mine = db.nominees.filter((n) => n.categoryId === cat.id && n.by === user.id).length;
  if (mine >= db.settings.maxNomineeProposals) fail(400, `Voit ehdottaa enintään ${db.settings.maxNomineeProposals} ehdokasta per kategoria.`);
  // Video: oma luonnos (ks. handleVideoUpload). Pakollinen, jos admin on niin määrännyt kategorialle.
  const video = body.videoId ? (db.videos || []).find((v) => v.id === body.videoId && v.draft && v.by === user.id) : null;
  if (body.videoId && !video) fail(400, 'Videota ei löytynyt. Lisää video uudelleen.');
  if (video && video.status === 'failed') fail(400, video.error || 'Videota ei voitu käsitellä. Lisää toinen video.');
  if (cat.videoRequired && !video) fail(400, `Kategoriaan ${cat.name} tarvitaan ehdotukseen video.`);
  const nom = { id: newId(), categoryId: cat.id, personId: person.id, name: person.name, reason, photo: null, finalist: false, by: user.id, createdAt: now() };
  if (video) { nom.videoId = video.id; delete video.draft; delete video.categoryId; video.nomineeId = nom.id; video.personId = person.id; }
  db.nominees.push(nom);
  writeDb();
  return stateFor(user);
});

// Osallistuja poistaa oman videoluonnoksensa (esim. vaihtaa videon ennen ehdottamista)
route('DELETE', '/api/videos/:id', ({ user, params }) => {
  const v = (db.videos || []).find((x) => x.id === params.id && x.draft && x.by === user.id);
  if (v) { deleteVideo(v); writeDb(); }
  return { ok: true };
});

// Osallistuja poistaa oman ehdokasehdotuksensa (vaihe 3, ennen lukitusta)
route('DELETE', '/api/nominees/:id', ({ user, params }) => {
  requirePhase(3);
  requireVoter(user);
  requireUnlocked(user);
  const nom = db.nominees.find((n) => n.id === params.id && n.by === user.id) || fail(404, 'Voit poistaa vain omia ehdotuksiasi.');
  removeNominee(nom);
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

// Vaihe 4: ehdokasäänestys. Osallistuja asettaa ehdokkaan sijalle 1.–3. (place 0 = poista sijalta).
// Jos sijalla on jo joku, he vaihtavat paikkaa (edellinen siirtyy valitun ehdokkaan vanhalle sijalle tai pois).
route('POST', '/api/ranks', ({ user, body }) => {
  requirePhase(4);
  requireVoter(user);
  requireUnlocked(user);
  const nom = db.nominees.find((n) => n.id === body.nomineeId && advancedCats().some((c) => c.id === n.categoryId)) || fail(404, 'Ehdokasta ei löydy.');
  const cid = nom.categoryId;
  const slots = rankSlots(cid);
  const place = Math.round(Number(body.place));
  if (!(place >= 0 && place <= slots)) fail(400, `Sijan pitää olla 1–${slots}.`);
  const arr = myRanking(user.id, cid);
  const from = arr.indexOf(nom.id);
  if (from >= 0) arr[from] = null;
  if (place > 0) {
    const prev = arr[place - 1];
    if (prev && from >= 0) arr[from] = prev; // vaihdetaan paikkoja
    arr[place - 1] = nom.id;
  }
  db.nomRanks[user.id] = { ...(db.nomRanks[user.id] || {}), [cid]: arr };
  db.nomRankAt[user.id] = { ...(db.nomRankAt[user.id] || {}), [cid]: now() };
  writeDb();
  return stateFor(user);
});

// Vaihe 5: finaali
route('POST', '/api/final', ({ user, body }) => {
  requirePhase(5);
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
  if (db.settings.phase > LAST_OPEN) fail(409, 'Äänestys on jo suljettu.');
  requireUnlocked(user);
  const ready = lockReady(user);
  if (!ready.ok) fail(400, ready.reason);
  user.locked = { ...(user.locked || {}), [db.settings.phase]: now() };
  if (user.unlockRequest) delete user.unlockRequest[db.settings.phase]; // vanha pyyntö ei koske uutta lukitusta
  writeDb();
  notifyLock(user);
  return { ...stateFor(user), notice: 'Lukko sisään! Vastauksesi tähän vaiheeseen on tallennettu.' };
});

// Lukon avauspyyntö odotusnäytöltä: tallennetaan käyttäjälle (näkyy hallinnan osallistujalistassa) ja
// ilmoitetaan adminien Discord-kanavalle. Uusi Discord-ilmoitus samasta vaiheesta aikaisintaan 30 min päästä.
function unlockRequested(user) {
  return !!(user && !user.tester && isLocked(user) && user.unlockRequest && user.unlockRequest[db.settings.phase]);
}
route('POST', '/api/unlock-request', ({ user }) => {
  requireVoter(user);
  const ph = db.settings.phase;
  if (ph > LAST_OPEN) fail(409, 'Äänestys on jo suljettu.');
  if (!isLocked(user)) fail(409, 'Vastauksesi eivät ole lukossa.');
  const prev = user.unlockRequest && user.unlockRequest[ph];
  user.unlockRequest = { ...(user.unlockRequest || {}), [ph]: now() };
  writeDb();
  if (!prev || Date.now() - Date.parse(prev) > 30 * 60 * 1000) {
    notify('requests', `🙋 **Lukon avauspyyntö:** ${user.name} haluaa avata vaiheen ${ph} (${PHASES[ph]}) lukon. Avaa hallinnasta: Osallistujat → Avaa lukko.`);
  }
  return stateFor(user);
});

// Palaute suljetussa vaiheessa ja jokaisen vaiheen odotustilassa (kun omat vastaukset on lukittu).
// Muille osallistujille nimetön, adminit näkevät kirjoittajan palautelokista vaiheittain eriteltynä.
route('POST', '/api/feedback', ({ user, body }) => {
  requireVoter(user);
  const phase = db.settings.phase;
  if (phase !== 6 && !isLocked(user)) fail(409, 'Palautteen voi lähettää, kun olet lukinnut vastauksesi.');
  const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 1000);
  if (text.length < 2) fail(400, 'Kirjoita palaute ensin.');
  db.feedback = db.feedback || [];
  if (db.feedback.filter((f) => f.userId === user.id && (f.phase || 6) === phase).length >= 20) fail(400, 'Olet jo lähettänyt paljon palautetta.');
  db.feedback.push({ id: newId(), userId: user.id, phase, text, createdAt: now() });
  writeDb();
  notify('feedback', `💬 **Palaute** (${phase === 6 ? 'Gaalan jälkeen' : `odotustila, vaihe ${phase}`}) · ${user.name}:\n${quote(text)}`);
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
  notify('photos', `🖼️ **Kuvaehdotus:** ${user.name} ehdotti kuvaa henkilölle ${person.name}.`);
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
  db.catVotes = []; db.nominees = []; db.nomRanks = {}; db.nomRankAt = {};
  db.finalVotes = {}; db.finalVoteAt = {}; db.feedback = [];
  db.settings.phase = 1; db.settings.deadline = ''; db.settings.nextStart = ''; db.settings.phaseEnds = {};
  for (const u of Object.values(db.users)) { u.locked = {}; u.unlockRequest = {}; }
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
  const cover = cleanHofCover(body.cover);
  db.hallOfFame = db.hallOfFame || [];
  const entry = body.id ? db.hallOfFame.find((y) => y.id === body.id) : null;
  if (body.id && !entry) fail(404, 'Vuotta ei löydy.');
  if (db.hallOfFame.some((y) => y.year === year && y !== entry)) fail(409, `Vuosi ${year} on jo Hall of Famessa. Muokkaa sitä.`);
  const before = entry ? hofImages([entry]) : new Set();
  if (entry) Object.assign(entry, { year, cover, categories, updatedAt: now() });
  else db.hallOfFame.push({ id: newId(), year, cover, categories, createdAt: now() });
  writeDb();
  dropUnusedHofImages(before);
  return { ...stateFor(user), notice: `Gaala ${year} tallennettu Hall of Fameen.` };
}, { admin: true, maxBody: 60000 });

// Hall of Fame -ehdokkaan kuva: tallennetaan heti, ja lomake liittää tiedostonimen ehdokkaaseen tallennettaessa.
// Kuva on erillinen tiedosto, ei osallistujan profiilikuva.
// Kuvan haku osoitteesta Hall of Fame -lomakkeen liittämistä varten. Google Slidesistä/Docsista kopioidun
// kuvan leikepöydällä on vain linkki Googlen kuvapalvelimelle, jota selain ei saa ladata toiselta sivustolta.
// Palvelin hakee kuvan, mutta vain Googlen kuvapalvelimilta (ei mielivaltaisia osoitteita eikä sisäverkkoa).
const IMAGE_FETCH_HOSTS = [/(^|\.)googleusercontent\.com$/i];
const IMAGE_FETCH_MAX = 10 * 1024 * 1024;
const allowedImageUrl = (u) => u.protocol === 'https:' && IMAGE_FETCH_HOSTS.some((re) => re.test(u.hostname));
function sniffImageType(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.slice(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.slice(0, 4).toString() === 'GIF8') return 'image/gif';
  return null;
}
async function fetchRemoteImage(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { fail(400, 'Virheellinen kuvan osoite.'); }
  for (let hop = 0; hop < 4; hop++) {
    if (!allowedImageUrl(url)) fail(400, 'Kuvaa voi hakea vain Google Slidesistä tai Docsista kopioidusta linkistä. Tallenna kuva ja raahaa se riville.');
    let res;
    try { res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); } catch { fail(502, 'Kuvan haku epäonnistui. Tarkista nettiyhteys tai tallenna kuva ja raahaa se riville.'); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), url); continue; }
    if (!res.ok) fail(502, `Kuvaa ei saatu haettua (${res.status}). Linkki on voinut vanhentua: kopioi kuva uudelleen.`);
    if (Number(res.headers.get('content-length')) > IMAGE_FETCH_MAX) fail(413, 'Kuva on liian suuri (max 10 Mt).');
    const chunks = []; let size = 0;
    for await (const c of res.body) { size += c.length; if (size > IMAGE_FETCH_MAX) fail(413, 'Kuva on liian suuri (max 10 Mt).'); chunks.push(c); }
    const data = Buffer.concat(chunks);
    // Tyyppi tunnistetaan sisällöstä; otsakkeeseen ei luoteta (se voi puuttua tai olla geneerinen)
    const type = sniffImageType(data) || fail(400, 'Linkin takana ei ole kuvaa.');
    return { type, data };
  }
  fail(502, 'Liikaa uudelleenohjauksia kuvan haussa.');
}
// Palauttaa kuvan selaimelle data-osoitteena: selain pienentää ja lähettää sen samaa reittiä kuin muutkin kuvat
route('POST', '/api/admin/fetch-image', async ({ body }) => {
  const { type, data } = await fetchRemoteImage(body.url);
  return { image: `data:${type};base64,${data.toString('base64')}` };
}, { admin: true, maxBody: 20000 });

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
  if (db.settings.phase !== 6) fail(409, 'Tulokset voi arkistoida, kun äänestys on suljettu (vaihe 6).');
  const year = cleanYear(body.year);
  db.hallOfFame = db.hallOfFame || [];
  if (db.hallOfFame.some((y) => y.year === year)) fail(409, `Vuosi ${year} on jo Hall of Famessa. Poista tai muokkaa sitä ensin.`);
  const cats = advancedCats();
  // Sijat 1.–3. samalla tavalla kuin palkintosivuilla; palkintosivun linkki (QR) siirtyy kategorian mukana
  const categories = cats.map((c) => {
    const places = Object.fromEntries(placesFor(c).map((x) => [x.n.id, x.place]));
    return {
      name: c.name, description: c.description || '', awardToken: c.awardToken || newAwardToken(),
      nominees: db.nominees.filter((n) => n.categoryId === c.id && n.finalist).map((n) => ({ name: nomName(n), reason: n.reason || '', personId: n.personId || null, winner: places[n.id] === 1, place: places[n.id] || null, ...copyCardPhoto(n) }))
        .sort((a, b) => (a.place || 9) - (b.place || 9) || a.name.localeCompare(b.name, 'fi')),
    };
  }).filter((c) => c.nominees.length);
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
  if (body.unlock && u.locked && u.locked[db.settings.phase]) {
    delete u.locked[db.settings.phase];
    if (u.unlockRequest) delete u.unlockRequest[db.settings.phase];
    notify('locks', `🔓 ${user.name} avasi lukon: ${u.name} (vaihe ${db.settings.phase}).`);
  }
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
  if (f('result', 20) === 'virhe') {
    notify('errors', `⚠️ **Kuvalataus epäonnistui** · ${user.name}\nVirhe: ${f('error', 300) || '-'}\nTiedosto: ${f('name', 80) || '-'} · ${f('type', 40) || 'ei tyyppiä'} · ${Math.round((Number(body.size) || 0) / 1024)} kt · muoto ${f('kind', 12) || '-'} · kohta ${f('stage', 160)}\nSelain: ${browserName(f('ua', 200))}`);
  }
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
    ranks: Object.keys(db.nomRanks[u.id] || {}).filter((cid) => cat(cid)).flatMap((cid) => myRanking(u.id, cid).map((nid, i) => (nid ? { category: catName(cid), place: i + 1, name: nomName(nom(nid)), reason: nom(nid).reason, at: ((db.nomRankAt || {})[u.id] || {})[cid] || null } : null)).filter(Boolean)),
    finals: Object.entries(fin).filter(([, nid]) => nom(nid)).map(([cid, nid]) => ({ category: catName(cid), name: nomName(nom(nid)), reason: nom(nid).reason, at: finAt[cid] || null })),
    feedback: (db.feedback || []).filter((f) => f.userId === u.id).map((f) => ({ text: f.text, at: f.createdAt, phase: f.phase || 6 })),
  };
}, { admin: true });

route('DELETE', '/api/admin/users/:id', ({ user, params }) => {
  const u = db.users[params.id];
  if (!u || u.root) fail(404, 'Osallistujaa ei löydy.');
  if (u.id === user.id) fail(400, 'Et voi poistaa itseäsi.');
  deleteImage(u.photo);
  for (const x of (db.photoSuggestions || []).filter((y) => y.personId === u.id)) deleteImage(x.image);
  db.photoSuggestions = (db.photoSuggestions || []).filter((y) => y.personId !== u.id);
  // Adminin Videot-sivun videot henkilöstä ja hänen omat luonnoksensa pois (ehdokkaiden videot jäävät ehdokkaiden mukana)
  for (const v of (db.videos || []).filter((x) => (!x.nomineeId && x.personId === u.id) || (x.draft && x.by === u.id))) deleteVideo(v);
  delete db.users[u.id];
  db.catVotes = db.catVotes.filter((v) => v.userId !== u.id);
  delete db.nomRanks[u.id];
  if (db.nomRankAt) delete db.nomRankAt[u.id];
  delete db.finalVotes[u.id];
  if (db.finalVoteAt) delete db.finalVoteAt[u.id];
  writeDb();
  return stateFor(user);
}, { admin: true });

// Videon otsikon muutos ja poisto (lähetys: handleVideoUpload)
route('POST', '/api/admin/videos/:id', ({ user, params, body }) => {
  const v = (db.videos || []).find((x) => x.id === params.id) || fail(404, 'Videota ei löydy.');
  v.title = clean(body.title, 80);
  writeDb();
  return { ...stateFor(user), notice: 'Otsikko tallennettu.' };
}, { admin: true });
route('DELETE', '/api/admin/videos/:id', ({ user, params }) => {
  const v = (db.videos || []).find((x) => x.id === params.id) || fail(404, 'Videota ei löydy.');
  deleteVideo(v);
  writeDb();
  return { ...stateFor(user), notice: 'Video poistettu.' };
}, { admin: true });

route('POST', '/api/admin/phase', ({ user, body }) => {
  const phase = Number(body.phase);
  if (!PHASES[phase]) fail(400, 'Tuntematon vaihe.');
  // Kiinteä kategoria on aina mukana, joten tarkistetaan vain äänestyksellä valittavat
  if (phase >= 3 && !advancedCats().some((c) => !c.fixed)) fail(400, 'Valitse ensin jatkoon pääsevät kategoriat.');
  if (phase >= 4 && phase <= LAST_OPEN) {
    const empty = advancedCats().filter((c) => !db.nominees.some((n) => n.categoryId === c.id));
    if (phase === 4 && empty.length) fail(400, `Näissä kategorioissa ei ole vielä ehdokkaita: ${empty.map((c) => c.name).join(', ')}.`);
  }
  if (phase >= 5) {
    const missing = advancedCats().filter((c) => !db.nominees.some((n) => n.categoryId === c.id && n.finalist));
    if (missing.length) fail(400, `Valitse finalistit myös näihin: ${missing.map((c) => c.name).join(', ')}.`);
  }
  const changed = db.settings.phase !== phase;
  if (changed) db.settings.nextStart = ''; // vanha "seuraava vaihe alkaa" -aika ei enää päde
  db.settings.phase = phase;
  writeDb();
  if (changed) {
    const end = phase <= LAST_OPEN && db.settings.phaseEnds && db.settings.phaseEnds[phase];
    notify('phases', `📣 **Vaihe ${phase} avattu: ${PHASES[phase]}** (${user.name})${end ? ` · päättyy ${fmtWall(end)}` : ''}`);
  }
  return stateFor(user);
}, { admin: true });

route('POST', '/api/admin/settings', ({ user, body }) => {
  const s = db.settings;
  if ('deadline' in body) s.deadline = clean(body.deadline, 80);
  if ('nextStart' in body) s.nextStart = clean(body.nextStart, 80);
  if ('safeMode' in body) s.safeMode = !!body.safeMode;
  if ('hofPublished' in body) s.hofPublished = !!body.hofPublished;
  if ('awardsPublished' in body) s.awardsPublished = !!body.awardsPublished;
  if ('awardBaseUrl' in body) {
    const u = String(body.awardBaseUrl || '').trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(u)) fail(400, 'Osoite on muotoa https://palvelin.esimerkki.net (ilman polkua).');
    s.awardBaseUrl = u;
  }
  if (body.phaseEnds && typeof body.phaseEnds === 'object') {
    const ends = {};
    for (const p of [1, 2, 3, 4, 5]) {
      const v = String(body.phaseEnds[p] ?? '').trim();
      if (!v) continue;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(400, `Vaiheen ${p} päättymisaika on virheellinen.`);
      ends[p] = v;
    }
    s.phaseEnds = ends;
  }
  for (const k of ['targetCategories', 'catVotes', 'maxCategoryProposals', 'maxNomineeProposals', 'finalists']) {
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
  if ('videoRequired' in body) { cat.videoRequired = !!body.videoRequired; writeDb(); return stateFor(user); }
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

// Valitse jokaiseen kategoriaan N eniten pisteitä saanutta finalistiksi (N = asetus finalists).
// Pisteet ehdokasäänestyksestä (1. sija 3 p, 2. sija 2 p, 3. sija 1 p). Tasapisteissä ratkaisee enemmän
// 1. sijoja, sitten 2. sijoja; jos sekin on tasan, aiemmin ehdotettu ensin ja admin saa varoituksen.
route('POST', '/api/admin/nominees/auto-finalists', ({ user }) => {
  const scores = rankScores();
  const key = (x) => { const s = scores[x.id] || { points: 0, places: [0, 0, 0] }; return [s.points, ...s.places]; };
  const cmp = (a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i]; return 0; };
  const n = db.settings.finalists; const ties = [];
  for (const c of advancedCats()) {
    const ranked = db.nominees.filter((x) => x.categoryId === c.id)
      .sort((a, b) => cmp(a, b) || a.createdAt.localeCompare(b.createdAt));
    ranked.forEach((x, i) => {
      x.finalist = i < n;
      if (!x.finalist) for (const fv of Object.values(db.finalVotes)) if (fv[c.id] === x.id) delete fv[c.id];
    });
    if (ranked.length > n && key(ranked[n - 1])[0] > 0 && cmp(ranked[n - 1], ranked[n]) === 0) ties.push(c.name);
  }
  writeDb();
  return { ...stateFor(user), notice: ties.length ? `Valittu ${n} eniten pisteitä saanutta per kategoria. Täysi tasapeli viimeisellä paikalla: ${ties.join(', ')} – tarkista.` : `Valittu ${n} eniten pisteitä saanutta per kategoria.` };
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

// ---------- Palkintosivut (QR-koodit pokaalien pohjissa) ----------
// Jokaisella Gaalaan päässeellä kategorialla on pysyvä, arvaamaton linkki /p/<tunniste>. Sivu näkyy ilman kirjautumista:
// ennen julkaisua vain kategorian nimi ("Voittaja julkistetaan Gaalassa"), julkaisun jälkeen sijat 1.–3. kuvineen.
// Kun vuosi arkistoidaan Hall of Fameen, tunniste siirtyy mukana, joten pokaalin QR-koodi toimii jatkossakin.
const AWARD_TOKEN_RE = /^[A-Za-z0-9_-]{10}$/;
const newAwardToken = () => crypto.randomBytes(8).toString('base64url').slice(0, 10);
const hofPlace = (n) => ([1, 2, 3].includes(n.place) ? n.place : n.winner ? 1 : null);
function galaYear() { return Number(tzNow().date.slice(0, 4)); }

// Sijat finaalin äänimääristä (tasapelissä sama sija, kilpailusijoitus 1, 1, 3). Admin voi asettaa sijat käsin.
function placesFor(cat) {
  const fins = db.nominees.filter((n) => n.categoryId === cat.id && n.finalist);
  const manual = cat.awardPlaces && Object.keys(cat.awardPlaces).length ? cat.awardPlaces : null;
  const counts = finalCounts();
  const v = (n) => counts[n.id] || 0;
  const list = manual
    ? fins.map((n) => ({ n, place: [1, 2, 3].includes(manual[n.id]) ? manual[n.id] : null }))
    : fins.map((n) => ({ n, place: v(n) ? 1 + fins.filter((m) => v(m) > v(n)).length : null }));
  return list.filter((x) => x.place && x.place <= 3).sort((a, b) => a.place - b.place || nomName(a.n).localeCompare(nomName(b.n), 'fi'));
}

function ensureAwardTokens() {
  let changed = false;
  for (const c of advancedCats()) if (!c.awardToken) { c.awardToken = newAwardToken(); changed = true; }
  for (const y of db.hallOfFame || []) for (const c of y.categories) if (!c.awardToken) { c.awardToken = newAwardToken(); changed = true; }
  if (changed) writeDb();
}

// Hall of Fame (arkistoitu) ensin, sitten tämän vuoden kategoriat
function findAward(token) {
  if (!AWARD_TOKEN_RE.test(token)) return null;
  for (const y of db.hallOfFame || []) for (const c of y.categories) if (c.awardToken === token) return { hof: y, cat: c };
  const cat = db.categories.find((c) => c.awardToken === token && c.advanced);
  return cat ? { cat } : null;
}

// Julkinen näkymä. Kuvien osoitteet ovat muotoa /p/<tunniste>/img/<tiedosto>, ja vain tämän sivun kuvat ovat saatavilla.
function awardPublic(token) {
  const a = findAward(token);
  if (!a) return null;
  const pub = (photo) => (photo ? { ...photo, src: `/p/${token}/img/${photo.src.slice('/images/'.length)}` } : null);
  if (a.hof) {
    const places = a.cat.nominees.filter((n) => hofPlace(n)).map((n) => ({
      place: hofPlace(n), name: n.name, reason: n.reason || '', photo: db.settings.safeMode ? null : pub(photoOf(n.image, n.crop)),
    })).sort((x, y) => x.place - y.place);
    return { year: a.hof.year, name: a.cat.name, description: a.cat.description || '', published: true, archived: true, places };
  }
  const published = !!db.settings.awardsPublished;
  return {
    year: galaYear(), name: a.cat.name, description: a.cat.description || '', published, archived: false,
    places: published ? placesFor(a.cat).map(({ n, place }) => ({ place, name: nomName(n), reason: n.reason || '', photo: pub(nomPhoto(n)) })) : [],
  };
}

route('GET', '/api/award/:token', ({ user, params }) => {
  const a = awardPublic(params.token);
  if (!a) fail(404, 'Palkintosivua ei löydy.');
  return { ...a, loggedIn: !!user };
}, { auth: false });

function serveAwardImage(res, pathname) {
  const [, , token, , name] = pathname.split('/');
  const a = awardPublic(token);
  const ok = a && IMG_NAME.test(name || '') && a.places.some((p) => p.photo && p.photo.src.endsWith('/' + name));
  if (!ok) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(IMG_DIR, name), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)], 'Cache-Control': 'public, max-age=3600' });
    res.end(data);
  });
}

// Hallinnan lista: tämän vuoden kategoriat sijoineen sekä Hall of Famen vuodet
function awardsAdmin() {
  ensureAwardTokens();
  const counts = finalCounts();
  return {
    published: !!db.settings.awardsPublished,
    baseUrl: db.settings.awardBaseUrl || '',
    current: advancedCats().map((c) => ({
      id: c.id, name: c.name, token: c.awardToken, manual: !!(c.awardPlaces && Object.keys(c.awardPlaces).length),
      places: placesFor(c).map(({ n, place }) => ({ place, name: nomName(n) })),
      finalists: db.nominees.filter((n) => n.categoryId === c.id && n.finalist).map((n) => ({ id: n.id, name: nomName(n), votes: counts[n.id] || 0, place: (c.awardPlaces || {})[n.id] || null })),
    })),
    archived: (db.hallOfFame || []).slice().sort((a, b) => b.year - a.year).map((y) => ({
      year: y.year,
      categories: y.categories.map((c) => ({ name: c.name, token: c.awardToken, places: c.nominees.filter((n) => hofPlace(n)).map((n) => ({ place: hofPlace(n), name: n.name })).sort((a, b) => a.place - b.place) })),
    })),
  };
}

// Sijat käsin (esim. tasapelin ratkaisu): { places: { nomineeId: 1|2|3|null } } tai { reset: true } = takaisin äänimääriin
route('POST', '/api/admin/awards/:id/places', ({ user, params, body }) => {
  const c = db.categories.find((x) => x.id === params.id && x.advanced) || fail(404, 'Kategoriaa ei löydy.');
  if (body.reset) delete c.awardPlaces;
  else {
    const fins = new Set(db.nominees.filter((n) => n.categoryId === c.id && n.finalist).map((n) => n.id));
    const places = {};
    for (const [id, p] of Object.entries(body.places || {})) if (fins.has(id) && [1, 2, 3].includes(Number(p))) places[id] = Number(p);
    c.awardPlaces = places;
  }
  writeDb();
  return { ...stateFor(user), notice: body.reset ? 'Sijat lasketaan taas finaalin äänistä.' : `Sijat tallennettu: ${c.name}.` };
}, { admin: true });

// ---------- Discord-ilmoitukset ----------
// Palvelin lähettää tapahtumista viestin Discord-kanavalle webhookin kautta (pelkkä HTTPS-pyyntö, ei bottia).
// Osoite asetetaan hallinnasta (tallentuu tietokantaan) tai ympäristömuuttujalla DISCORD_WEBHOOK. Jos osoitetta
// ei ole, ilmoitukset ovat pois päältä eikä mikään muu muutu. Discordin katko ei koskaan kaada gaalaa.
const NOTIFY_KINDS = { errors: 'Virheet (kuvalataukset, palvelinvirheet)', requests: 'Lukon avauspyynnöt', locks: 'Lukitukset', phases: 'Vaiheen vaihtuminen', feedback: 'Palautteet', photos: 'Kuvaehdotukset', reminders: 'Muistutukset lukitsemattomista' };
const NOTIFY_TZ = process.env.GAALA_TZ || 'Europe/Helsinki'; // vaiheiden päättymisajat ja muistutukset tämän ajan mukaan
const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function webhookUrl() { return db.settings.discordWebhook || process.env.DISCORD_WEBHOOK || ''; }
function notifyOn(kind) { return (db.settings.notifyKinds || {})[kind] !== false; } // oletuksena kaikki päällä
function reminderTime() { return db.settings.reminderTime ?? '18:00'; } // '' = ei päivittäistä muistutusta
const quote = (t) => String(t).split('\n').slice(0, 15).map((l) => `> ${l}`).join('\n').slice(0, 1500);
function browserName(ua) {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : '';
  const br = /Brave/.test(ua) ? 'Brave' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' / ') || String(ua).slice(0, 80) || '-';
}

// Jono: viestit lähetetään yksi kerrallaan, ja ruuhkassa useampi yhdistetään yhdeksi (Discordin raja ~30 / min)
const notifyQueue = [];
let notifyBusy = false;
function notify(kind, text) {
  if (!webhookUrl() || !notifyOn(kind)) return;
  notifyQueue.push(String(text).slice(0, 1900));
  if (notifyQueue.length > 40) notifyQueue.splice(0, notifyQueue.length - 40);
  pumpNotify();
}
async function postDiscord(content, url = webhookUrl(), extra = {}) {
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // allowed_mentions: käyttäjien teksti (esim. "@everyone" palautteessa) ei koskaan pingaa ketään;
    // julkinen tiedote saa pingata vain erikseen asetetun roolin (extra.allowed_mentions)
    body: JSON.stringify({ content, username: 'HerrasmiesKlubi Gaala', allowed_mentions: { parse: [] }, ...extra }),
    signal: AbortSignal.timeout(10000),
  });
}
async function pumpNotify() {
  if (notifyBusy) return;
  notifyBusy = true;
  try {
    while (notifyQueue.length) {
      let msg = notifyQueue.shift();
      while (notifyQueue.length && msg.length + 2 + notifyQueue[0].length <= 1900) msg += '\n\n' + notifyQueue.shift();
      try {
        let r = await postDiscord(msg);
        if (r.status === 429) { // liikaa viestejä: odotetaan Discordin pyytämä aika ja yritetään kerran uudelleen
          const wait = Math.min(30, Number((await r.json().catch(() => ({}))).retry_after) || 2);
          await new Promise((ok) => setTimeout(ok, wait * 1000));
          r = await postDiscord(msg);
        }
        if (!r.ok) console.error(`[discord] lähetys epäonnistui: HTTP ${r.status}`);
      } catch (e) {
        console.error(`[discord] lähetys epäonnistui: ${(e && e.message) || e}`);
      }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  } finally {
    notifyBusy = false;
  }
}

// Aikavyöhykeapurit: phaseEnds on muotoa "2026-11-27T20:00" Suomen aikaa, mutta kontin kello on UTC
function tzNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: NOTIFY_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
function wallToMs(wall) { // "YYYY-MM-DDTHH:MM" paikallista aikaa → millisekunnit
  const guess = Date.parse(`${wall}:00Z`);
  const t = tzNow(new Date(guess));
  return guess - (Date.parse(`${t.date}T${t.time}:00Z`) - guess);
}
function fmtWall(wall) { // "pe 27.11. klo 20.00"
  const [d, t] = String(wall).split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const wd = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${wd} ${dd}.${m}. klo ${String(t || '').replace(':', '.')}`;
}

function voters() { return Object.values(db.users).filter((u) => !u.root && !u.tester); }
function unlockedVoters(phase = db.settings.phase) { return voters().filter((u) => !(u.locked && u.locked[phase])); }

function notifyLock(user) {
  const ph = db.settings.phase; const all = voters(); const missing = unlockedVoters(ph);
  notify('locks', `🔒 ${user.name} lukitsi vaiheen ${ph} (${all.length - missing.length}/${all.length} lukinnut)`);
  if (!missing.length) notify('locks', `✅ **Kaikki ${all.length} ovat lukinneet vaiheen ${ph} (${PHASES[ph]}).** Seuraavan vaiheen voi avata hallinnasta.`);
}

// Muistutukset: tarkistetaan kerran minuutissa. Lähetetyt muistutukset merkitään tietokantaan (notifySent),
// joten samaa muistutusta ei lähetetä kahdesti, vaikka palvelin käynnistyisi uudelleen.
function reminderTick() {
  const ph = db.settings.phase;
  if (!webhookUrl() || !notifyOn('reminders') || ph < 1 || ph > LAST_OPEN) return;
  const sent = (db.notifySent = db.notifySent || {});
  let dirty = false;
  const mark = (key) => { if (sent[key]) return false; sent[key] = now(); dirty = true; return true; };
  const missing = unlockedVoters(ph); const total = voters().length;
  const names = missing.map((u) => u.name).join(', ');
  const end = (db.settings.phaseEnds || {})[ph];
  const endTxt = end ? ` · vaihe päättyy ${fmtWall(end)}` : '';
  const msgs = [];
  if (end) {
    const left = wallToMs(end) - Date.now();
    // Lähin aikaraja ensin: jos ollaan jo alle 2 h päässä, vuorokausimuistutus merkitään lähetetyksi ilman viestiä
    const due = [[2, 'Kaksi tuntia'], [24, 'Vuorokausi']].find(([h]) => left > 0 && left <= h * 3600e3);
    if (due) {
      const [h, label] = due;
      const fresh = mark(`end${h}:${ph}:${end}`);
      if (h === 2) mark(`end24:${ph}:${end}`);
      if (fresh && missing.length) msgs.push(`⏳ **${label} vaiheen ${ph} loppuun** (${fmtWall(end)}): ${missing.length}/${total} lukitsematta: ${names}`);
    }
    if (left <= 0 && left > -12 * 3600e3 && mark(`ended:${ph}:${end}`)) {
      msgs.push(missing.length
        ? `🏁 **Vaiheen ${ph} päättymisaika meni** (${fmtWall(end)}). Lukitsematta ${missing.length}/${total}: ${names}. Vaihe vaihtuu, kun admin avaa seuraavan.`
        : `🏁 **Vaiheen ${ph} päättymisaika meni** (${fmtWall(end)}). Kaikki ovat lukinneet, seuraavan vaiheen voi avata.`);
    }
  }
  // Päivittäinen muistutus (ei samalla kertaa, jos päättymismuistutus juuri lähti)
  const { date, time } = tzNow();
  const daily = reminderTime();
  if (daily && time >= daily && mark(`daily:${date}:${ph}`) && missing.length && !msgs.length) {
    msgs.push(`⏰ **Päivän muistutus · vaihe ${ph} (${PHASES[ph]})**: ${missing.length}/${total} lukitsematta: ${names}${endTxt}`);
  }
  const keys = Object.keys(sent);
  if (keys.length > 300) { for (const k of keys.sort((a, b) => sent[a].localeCompare(sent[b])).slice(0, keys.length - 300)) delete sent[k]; dirty = true; }
  if (dirty) writeDb();
  for (const m of msgs) notify('reminders', m);
}
const safeTick = () => {
  try { reminderTick(); } catch (e) { console.error('[discord] muistutus epäonnistui', e); }
  try { bulletinTick(); } catch (e) { console.error('[discord] tiedote epäonnistui', e); }
};
setTimeout(safeTick, 10 * 1000).unref(); // heti käynnistyksen jälkeen (esim. päivityksen jälkeen kesken päivän)
setInterval(safeTick, 60 * 1000).unref();

// ---------- Julkinen päivittäinen tiedote ----------
// Toinen webhook gaalaosallistujien kanavalle: kerran päivässä virallinen kaksikielinen tiedote siitä, montako on
// lyönyt vaiheen lukkoon ja paljonko aikaa vaiheen loppuun on. Rooli (esim. @Gaala-jäsenet) pingataan vain, jos
// sen ID on asetettu. Lukitsemattomien nimet listataan kummankin kielen kappaleen perään (asetus bulletinNames,
// oletuksena päällä). Jos kukaan ei ole vielä lukinnut, listaa ei näytetä (siinä olisivat kaikki).
function bulletinTime() { return db.settings.bulletinTime ?? '12:00'; }
const bulletinNamesOn = () => db.settings.bulletinNames !== false;
// Tiedotteen ulkopuolelle rajatut (esim. adminit, jotka ehdottavat mutta eivät äänestä): eivät näy
// tiedotteen lukumäärissä eivätkä nimilistassa. Adminien kanavan muistutuksiin rajaus ei vaikuta.
const bulletinSkip = () => new Set(db.settings.bulletinSkip || []);
const bulletinVoters = () => { const skip = bulletinSkip(); return voters().filter((u) => !skip.has(u.id)); };
// Discordin muotoilumerkit nimissä (*, _, ~ jne.) näytetään sellaisinaan eikä muotoiluna
const mdEscape = (t) => String(t).replace(/([\\*_~`|>#\[\]()-])/g, '\\$1');
const DISCORD_MAX = 2000;
const PHASE_EN = { 1: 'Category Suggestions', 2: 'Category Voting', 3: 'Nominee Suggestions', 4: 'Nominee Voting', 5: 'Final' };
const PHASE_IN_FI = { 1: 'kategorioiden ehdotusvaiheessa', 2: 'kategorioiden äänestysvaiheessa', 3: 'ehdokkaiden ehdotusvaiheessa', 4: 'ehdokkaiden äänestysvaiheessa', 5: 'finaalivaiheessa' };
const PHASE_NOM_FI = { 1: 'kategorioiden ehdotusvaihe', 2: 'kategorioiden äänestysvaihe', 3: 'ehdokkaiden ehdotusvaihe', 4: 'ehdokkaiden äänestysvaihe', 5: 'finaalivaihe' };
const PHASE_WHAT = { // mitä lyödään lukkoon: [suomeksi, englanniksi]
  1: ['kategoriaehdotuksensa', 'category suggestions'], 2: ['kategoriaäänensä', 'category votes'],
  3: ['ehdokasehdotuksensa', 'nominee suggestions'], 4: ['ehdokasäänensä', 'nominee rankings'], 5: ['finaaliäänensä', 'final votes'],
};
const WD_FI = ['sunnuntaina', 'maanantaina', 'tiistaina', 'keskiviikkona', 'torstaina', 'perjantaina', 'lauantaina'];
const WD_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Vaiheen päättymisen kuvaus molemmilla kielillä: tänään / huomenna / N päivän päästä (kalenteripäivinä Suomen aikaa)
function bulletinWhen(end) {
  if (!end) return { fi: 'Vaiheen päättymisajankohdasta tiedotetaan erikseen.', en: 'The closing time of the phase will be announced separately.' };
  const [d, t] = end.split('T'); const [y, m, dd] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  const dateTxt = `${dd}.${m}.${y}`; const timeTxt = t.replace(':', '.');
  const today = tzNow().date;
  const days = Math.round((Date.UTC(y, m - 1, dd) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const left = wallToMs(end) - Date.now();
  if (left <= 0) return { fi: `Vaiheen päättymisaika (${dateTxt} klo ${timeTxt}) on umpeutunut, ja hallitus avaa seuraavan vaiheen piakkoin.`, en: `The closing time of the phase (${dateTxt} at ${timeTxt}) has passed, and the Administration will open the next phase shortly.` };
  if (days <= 0) {
    const h = Math.max(1, Math.round(left / 3600000));
    return { fi: `Vaihe päättyy tänään ${WD_FI[wd]} ${dateTxt} klo ${timeTxt}, joten aikaa on jäljellä enää noin ${h} ${h === 1 ? 'tunti' : 'tuntia'}.`, en: `The phase ends today, ${WD_EN[wd]} ${dateTxt}, at ${timeTxt}, leaving only about ${h} ${h === 1 ? 'hour' : 'hours'}.` };
  }
  if (days === 1) return { fi: `Vaihe päättyy huomenna ${WD_FI[wd]} ${dateTxt} klo ${timeTxt}.`, en: `The phase ends tomorrow, ${WD_EN[wd]} ${dateTxt}, at ${timeTxt}.` };
  return { fi: `Vaihe päättyy ${WD_FI[wd]} ${dateTxt} klo ${timeTxt}, joten aikaa on jäljellä ${days} päivää.`, en: `The phase ends on ${WD_EN[wd]} ${dateTxt} at ${timeTxt}, which leaves ${days} days.` };
}

function bulletinText() {
  const ph = db.settings.phase;
  if (ph < 1 || ph > LAST_OPEN) return null;
  const members = bulletinVoters();
  const missingUsers = members.filter((u) => !(u.locked && u.locked[ph])).sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  const total = members.length; const missing = missingUsers.length; const locked = total - missing;
  const role = db.settings.publicRoleId ? `<@&${db.settings.publicRoleId}>` : 'Gaala-jäsenet';
  const [whatFi, whatEn] = PHASE_WHAT[ph];
  const when = bulletinWhen((db.settings.phaseEnds || {})[ph]);
  let fi; let en;
  if (!missing) {
    fi = `Gaalan hallitus on ilolla todennut, että ${PHASE_IN_FI[ph]} jokainen ${total} jäsenestä on lyönyt ${whatFi} lukkoon. Hallitus esittää tästä lämpimät kiitoksensa. ${when.fi}`;
    en = `The Gaala Administration is delighted to report that in the ${PHASE_EN[ph]} phase, all ${total} members have locked in their ${whatEn}. The Administration extends its warmest thanks. ${when.en}`;
  } else if (!locked) {
    fi = `Gaalan hallitus tiedottaa, että ${PHASE_NOM_FI[ph]} on käynnissä, eikä yksikään ${total} jäsenestä ole vielä lyönyt ${whatFi} lukkoon. Hallitus odottaa ensimmäisiä lukituksia suurella mielenkiinnolla. ${when.fi} Käyttehän lyömässä valintanne lukkoon, kun vielä kerkeätte.`;
    en = `The Gaala Administration wishes to inform you that the ${PHASE_EN[ph]} phase is underway, and none of the ${total} members has yet locked in their ${whatEn}. The Administration awaits the first submissions with great interest. ${when.en} Please be sure to lock in your choices while you still have the chance.`;
  } else {
    fi = `Gaalan hallitus tiedottaa, että ${PHASE_IN_FI[ph]} ${locked}/${total} jäsentä on jo lyönyt ${whatFi} lukkoon. Hallitus kiittää lämpimästi kaikkia jo lukinneita ja muistuttaa kunnioittavasti, että ${missing} ${missing === 1 ? 'jäsen ei ole' : 'jäsentä ei ole'} vielä tehnyt niin. ${when.fi} Jos valintanne ovat vielä viimeistelyä vailla, käyttehän lyömässä ne lukkoon, kun vielä kerkeätte.`;
    en = `The Gaala Administration wishes to inform you that in the ${PHASE_EN[ph]} phase, ${locked} of ${total} members have already locked in their ${whatEn}. The Administration warmly thanks everyone who has done so and respectfully reminds the remaining ${missing} ${missing === 1 ? 'member' : 'members'} to follow suit. ${when.en} If your choices still need a finishing touch, please be sure to lock them in while you still have the chance.`;
  }
  const build = (list) => [
    `Arvoisat ${role}!`, '', fi, ...list, '',
    '**Same in English for our international people:**', '',
    `Esteemed ${role}!`, '', en, ...list, '',
    // allekirjoitus kursiivilla rivi kerrallaan (Discordin *…* ei aina jatku rivinvaihdon yli)
    '*The Gaala Administration,*', '*by order of the HerrasmiesKlubi Council,*', '*under the gracious patronage of Default Settings Oy*', '',
    '-# Tämä on automaattinen viesti. / This is an automated message.',
  ].join('\n');
  if (!bulletinNamesOn() || !missing || !locked) return build([]);
  // Nimet luettelona. Jos viesti menisi yli Discordin 2000 merkin rajan, nimet pilkuilla yhdelle riville,
  // ja jos sekään ei mahdu, tiedote lähtee ilman nimiä (Discord hylkäisi liian pitkän viestin kokonaan).
  const names = missingUsers.map((u) => mdEscape(u.name));
  for (const list of [names.map((n) => `- ${n}`), [names.join(', ')]]) {
    const text = build(['', ...list]);
    if (text.length <= DISCORD_MAX) return text;
  }
  return build([]);
}

async function sendBulletin() {
  const content = bulletinText();
  if (!content || !db.settings.publicWebhook) return { ok: false, status: 0 };
  const roles = db.settings.publicRoleId ? [db.settings.publicRoleId] : [];
  const r = await postDiscord(content, db.settings.publicWebhook, { allowed_mentions: { parse: [], roles } });
  if (r.ok) { db.settings.bulletinLastSent = now(); writeDb(); }
  else console.error(`[discord] tiedotteen lähetys epäonnistui: HTTP ${r.status}`);
  return { ok: r.ok, status: r.status };
}

function bulletinTick() {
  const ph = db.settings.phase; const time = bulletinTime();
  if (!db.settings.publicWebhook || !time || ph < 1 || ph > LAST_OPEN) return;
  const t = tzNow();
  if (t.time < time) return;
  const sent = (db.notifySent = db.notifySent || {});
  const key = `bulletin:${t.date}`;
  if (sent[key]) return;
  sent[key] = now(); writeDb();
  sendBulletin().catch((e) => console.error(`[discord] tiedotteen lähetys epäonnistui: ${(e && e.message) || e}`));
}

route('POST', '/api/admin/bulletin-settings', ({ user, body }) => {
  const s = db.settings;
  if ('webhook' in body) {
    const url = String(body.webhook || '').trim();
    if (url && !WEBHOOK_RE.test(url)) fail(400, 'Tämä ei näytä Discordin webhook-osoitteelta (https://discord.com/api/webhooks/…).');
    if (url && url === webhookUrl()) fail(400, 'Tämä on adminien ilmoituskanavan webhook. Julkiselle tiedotteelle tarvitaan osallistujien kanavan oma webhook.');
    s.publicWebhook = url;
  }
  if ('roleId' in body) {
    const id = String(body.roleId || '').trim().replace(/^<@&|>$/g, '');
    if (id && !/^\d{15,22}$/.test(id)) fail(400, 'Roolin ID on numerosarja (Discord: Kehittäjätila → oikea klikkaus roolille → Kopioi roolin ID).');
    s.publicRoleId = id;
  }
  if ('time' in body) {
    const t = String(body.time || '').trim();
    if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) fail(400, 'Kellonaika on virheellinen (esim. 12:00).');
    s.bulletinTime = t;
  }
  if ('names' in body) s.bulletinNames = !!body.names;
  if (Array.isArray(body.skip)) s.bulletinSkip = [...new Set(body.skip.map(String))].filter((id) => voters().some((u) => u.id === id));
  writeDb();
  return { ...stateFor(user), notice: 'Tiedoteasetukset tallennettu.' };
}, { admin: true });

route('GET', '/api/admin/bulletin-preview', () => ({ text: bulletinText() || 'Tiedotetta ei lähetetä vaiheessa 6 (äänestys suljettu).' }), { admin: true });

route('POST', '/api/admin/bulletin-send', async ({ user }) => {
  if (!db.settings.publicWebhook) fail(400, 'Aseta ensin osallistujien kanavan webhook.');
  if (!bulletinText()) fail(409, 'Tiedotetta ei lähetetä vaiheessa 6 (äänestys suljettu).');
  let r;
  try { r = await sendBulletin(); } catch (e) { fail(502, `Discordiin ei saatu yhteyttä: ${(e && e.message) || e}`); }
  if (r.status === 401 || r.status === 404) fail(400, 'Discord ei tunnista webhookia. Onko se poistettu? Luo uusi ja tallenna se.');
  if (!r.ok) fail(502, `Discord vastasi virheellä (HTTP ${r.status}).`);
  // tämän päivän automaattinen tiedote katsotaan lähetetyksi, ettei samaa tule kahdesti
  (db.notifySent = db.notifySent || {})[`bulletin:${tzNow().date}`] = now(); writeDb();
  return { ...stateFor(user), notice: 'Tiedote lähetetty osallistujien kanavalle.' };
}, { admin: true });

// Hallinta: webhookin asetus, ilmoitustyypit ja päivittäisen muistutuksen kellonaika
route('POST', '/api/admin/notify-settings', ({ user, body }) => {
  const s = db.settings;
  if ('webhook' in body) {
    const url = String(body.webhook || '').trim();
    if (url && !WEBHOOK_RE.test(url)) fail(400, 'Tämä ei näytä Discordin webhook-osoitteelta (https://discord.com/api/webhooks/…).');
    s.discordWebhook = url;
  }
  if (body.kinds && typeof body.kinds === 'object') {
    s.notifyKinds = Object.fromEntries(Object.keys(NOTIFY_KINDS).map((k) => [k, body.kinds[k] !== false]));
  }
  if ('reminderTime' in body) {
    const t = String(body.reminderTime || '').trim();
    if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) fail(400, 'Muistutuksen kellonaika on virheellinen (esim. 18:00).');
    s.reminderTime = t;
  }
  writeDb();
  return { ...stateFor(user), notice: 'Ilmoitusasetukset tallennettu.' };
}, { admin: true });

route('POST', '/api/admin/notify-test', async ({ user }) => {
  if (!webhookUrl()) fail(400, 'Aseta ensin webhook-osoite.');
  const ph = db.settings.phase; const missing = unlockedVoters(ph);
  let r;
  try {
    r = await postDiscord(`👋 **Testiviesti HerrasmiesKlubi Gaalasta** (${user.name})\nVaihe ${ph} · ${PHASES[ph]}${ph <= LAST_OPEN ? ` · ${voters().length - missing.length}/${voters().length} lukinnut` : ''}`);
  } catch (e) {
    fail(502, `Discordiin ei saatu yhteyttä: ${(e && e.message) || e}`);
  }
  if (r.status === 401 || r.status === 404) fail(400, 'Discord ei tunnista webhookia. Onko se poistettu? Luo uusi ja tallenna se.');
  if (!r.ok) fail(502, `Discord vastasi virheellä (HTTP ${r.status}).`);
  return { ...stateFor(user), notice: 'Testiviesti lähetetty Discordiin.' };
}, { admin: true });

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
  if (pathname.startsWith('/videos/')) return serveVideo(req, res, pathname);
  if (req.method === 'POST' && pathname === '/api/admin/videos/upload') return handleVideoUpload(req, res, new URL(req.url, 'http://x'), 'admin');
  if (req.method === 'POST' && pathname === '/api/videos/upload') return handleVideoUpload(req, res, new URL(req.url, 'http://x'), 'nominee');
  if (/^\/p\/[\w-]+\/img\//.test(pathname)) return serveAwardImage(res, pathname);
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
    else {
      console.error(e); send(res, 500, { error: 'Palvelinvirhe.' });
      notify('errors', `🛑 **Palvelinvirhe** ${req.method} ${pathname}\n${String((e && e.message) || e).slice(0, 300)}`);
    }
  }
});

initVideos();
server.listen(PORT, HOST, () => {
  console.log(`HerrasmiesKlubi Gaala käynnissä: http://${HOST}:${PORT}`);
  // Auttaa vianetsinnässä paljastamatta koodia: näyttää pituuden ja ensimmäisen merkin
  console.log(`ADMIN_CODE ladattu: ${ADMIN_CODE.length} merkkiä, alkaa "${ADMIN_CODE[0]}"${ADMIN_CODE === 'vaihda-tama-pitkaan-koodiin' ? ' – HUOM: tämä on esimerkkiarvo, vaihda se .env-tiedostoon!' : ''}`);
});
