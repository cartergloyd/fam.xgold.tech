import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
const ORIGIN = 'https://fam.xgold.tech';
const MAX_FILE = 8 * 1024 * 1024;
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };
const DAYS = 30;
const sha = v => createHash('sha256').update(v).digest('hex');
export const pinHash = (userId, pin) => sha(`awards|${userId}|${pin}`);
const sign = (secret, payload, pinHashValue) => createHmac('sha256', secret).update(`awards|${payload}|${pinHashValue}`).digest('base64url');
// A session is the guest id and an expiry, signed with the guest's current passcode hash, so changing the passcode ends it.
export const issue = (guest, secret, now = Date.now()) => { const p = `${guest.user_id}.${now + DAYS * 86400000}`; return p + '.' + sign(secret, p, guest.pin_hash); };
function failure(code, message) { const e = Error(message); e.status = code; throw e; }
const text = (v, max, what) => { v ??= ''; if (typeof v !== 'string' || v.trim().length > max) failure(400, `${what} can be up to ${max} characters.`); return v.trim(); };
const readBody = req => new Promise((resolve, reject) => {
 const chunks = []; let size = 0;
 req.on('data', c => { size += c.length; if (size > MAX_FILE) { reject(Object.assign(Error('That file is over 8 MB.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
 req.on('end', () => resolve(Buffer.concat(chunks)));
 req.on('error', reject);
});
export default function awards(router, { database }, options = {}) {
 const secret = () => options.secret || process.env.SECRET;
 const limits = new Map();
 function limited(req, max) {
  const now = Date.now(), key = req.ip || 'unknown';
  for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  const r = limits.get(key) || { count: 0, until: now + 15 * 60000 }; limits.set(key, r);
  if (++r.count > max) failure(429, 'Too many attempts. Please try again in 15 minutes.');
 }
 const run = fn => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
   if (req.method !== 'GET' && req.get('Origin') !== ORIGIN) failure(403, 'Please use the family website.');
   await fn(req, res);
  } catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'Awards are temporarily unavailable. Please try again.' }); }
 };
 const guestFor = async req => {
  const [id, exp, sig, extra] = (req.get('X-Family-Session') || '').split('.');
  if (extra || !sig || !/^[\da-f-]{36}$/i.test(id) || !(Number(exp) > Date.now())) failure(401, 'Scan your invitation to sign in.');
  const g = await database('family_award_guests').where({ user_id: id }).first();
  const expected = g?.pin_hash ? sign(secret(), `${id}.${exp}`, g.pin_hash) : '';
  if (!g || expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) failure(401, 'Scan your invitation to sign in.');
  return g;
 };
 const byToken = async k => {
  if (typeof k !== 'string' || !/^[\w-]{16,64}$/.test(k)) failure(404, 'This invitation link is not valid.');
  const g = await database('family_award_guests').where({ token_hash: sha(k) }).first();
  if (!g) failure(404, 'This invitation link is not valid.');
  return g;
 };
 const nameOf = id => database('family_users').where({ id }).first();

 router.get('/awards/invite', run(async (req, res) => {
  limited(req, 60);
  const g = await byToken(req.query.k), u = await nameOf(g.user_id);
  res.json({ name: u.name, first_name: u.first_name || u.name.split(' ')[0], hasPin: !!g.pin_hash,
   photo_url: u.photo ? `https://fam-api.xgold.tech/family/photos/${u.id}?v=${encodeURIComponent(u.photo)}` : null });
 }));
 router.post('/awards/claim', run(async (req, res) => {
  limited(req, 40);
  const g = await byToken(req.body?.k), pin = req.body?.pin;
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) failure(400, 'Enter four digits.');
  if (g.locked_until && new Date(g.locked_until) > new Date()) failure(429, 'Too many wrong passcodes. Try again in 15 minutes.');
  const hash = pinHash(g.user_id, pin);
  if (!g.pin_hash) {
   const [saved] = await database('family_award_guests').where({ user_id: g.user_id }).whereNull('pin_hash').update({ pin_hash: hash }).returning('*');
   if (!saved) failure(409, 'A passcode was just set. Enter it to continue.');
   return res.status(201).json({ session: issue(saved, secret()) });
  }
  if (!timingSafeEqual(Buffer.from(g.pin_hash, 'hex'), Buffer.from(hash, 'hex'))) {
   const failed = g.failed + 1;
   await database('family_award_guests').where({ user_id: g.user_id }).update(failed >= 5 ? { failed: 0, locked_until: new Date(Date.now() + 15 * 60000) } : { failed });
   failure(401, 'That passcode does not match.');
  }
  await database('family_award_guests').where({ user_id: g.user_id }).update({ failed: 0, locked_until: null });
  res.json({ session: issue(g, secret()) });
 }));
 router.get('/awards/me', run(async (req, res) => {
  const g = await guestFor(req), u = await nameOf(g.user_id);
  const managers = await database('family_users').whereNotNull('fantasy_team').whereNot('status', 'disabled').orderBy('name').select('name', 'fantasy_team');
  const going = await database('family_award_guests as a').join('family_users as u', 'u.id', 'a.user_id').where('a.rsvp', true).orderBy('u.name').select('u.name');
  res.json({ name: u.name, first_name: u.first_name || u.name.split(' ')[0], admin: g.is_admin, rsvp: g.rsvp, ballot: g.ballot,
   upload: g.upload_name ? { name: g.upload_name, type: g.upload_type, at: g.upload_at } : null, managers, going: going.map(r => r.name) });
 }));
 router.put('/awards/rsvp', run(async (req, res) => {
  const g = await guestFor(req);
  if (typeof req.body?.going !== 'boolean') failure(400, 'Choose yes or no.');
  await database('family_award_guests').where({ user_id: g.user_id }).update({ rsvp: req.body.going, rsvp_at: new Date() });
  res.json({ rsvp: req.body.going });
 }));
 router.put('/awards/ballot', run(async (req, res) => {
  const g = await guestFor(req), input = req.body?.ballot;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 40) failure(400, 'That ballot could not be read.');
  const ballot = {};
  for (const [id, v] of Object.entries(input)) {
   if (!/^[a-z0-9-]{1,40}$/.test(id) || !v || typeof v !== 'object') failure(400, 'That ballot could not be read.');
   const nominee = text(v.nominee, 80, 'A nominee'), reason = text(v.reason, 300, 'A reason');
   if (nominee) ballot[id] = { nominee, reason };
  }
  await database('family_award_guests').where({ user_id: g.user_id }).update({ ballot: JSON.stringify(ballot), ballot_at: new Date() });
  res.json({ ballot });
 }));
 router.put('/awards/upload', run(async (req, res) => {
  const g = await guestFor(req), type = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPES[type]) failure(415, 'Upload a photo (JPEG, PNG, WebP, HEIC) or a PDF.');
  const body = await readBody(req);
  if (!body.length) failure(400, 'That file is empty.');
  const name = `ballot.${FILE_TYPES[type]}`;
  await database('family_award_guests').where({ user_id: g.user_id }).update({ upload: body, upload_type: type, upload_name: name, upload_at: new Date() });
  res.json({ upload: { name, type, at: new Date() } });
 }));
 router.delete('/awards/upload', run(async (req, res) => {
  const g = await guestFor(req);
  await database('family_award_guests').where({ user_id: g.user_id }).update({ upload: null, upload_type: null, upload_name: null, upload_at: null });
  res.json({ upload: null });
 }));
 // The file itself: your own, or any if you are an admin.
 router.get('/awards/upload/:id', run(async (req, res) => {
  const g = await guestFor(req), id = req.params.id === 'me' ? g.user_id : req.params.id;
  if (id !== g.user_id && !g.is_admin) failure(403, 'That ballot is private.');
  if (!/^[\da-f-]{36}$/i.test(id)) failure(404, 'No file.');
  const row = await database('family_award_guests').where({ user_id: id }).first();
  if (!row?.upload) failure(404, 'No file.');
  res.set('Content-Type', row.upload_type); res.set('X-Content-Type-Options', 'nosniff'); res.set('Content-Disposition', 'inline');
  res.end(row.upload);
 }));
 router.get('/awards/results', run(async (req, res) => {
  const g = await guestFor(req);
  if (!g.is_admin) failure(403, 'Results are private to the organizer.');
  const rows = await database('family_award_guests as a').join('family_users as u', 'u.id', 'a.user_id').orderBy('u.name')
   .select('a.user_id', 'u.name', 'a.rsvp', 'a.ballot', 'a.upload_name', 'a.pin_hash');
  res.json({ guests: rows.map(r => ({ id: r.user_id, name: r.name, rsvp: r.rsvp, ballot: r.ballot, upload: r.upload_name, joined: !!r.pin_hash })) });
 }));
}
