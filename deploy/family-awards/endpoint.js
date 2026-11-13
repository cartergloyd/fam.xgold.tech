import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
const ORIGIN = 'https://fam.xgold.tech';
const MAX_FILE = 8 * 1024 * 1024;
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };
const sha = v => createHash('sha256').update(v).digest('hex');
// The same hash family_users uses for the family PIN, so one passcode works here and everywhere else.
export const familyHash = (name, pin) => sha(`destin|${name}|${pin}`);
const sign = (secret, id, pinHash) => createHmac('sha256', secret).update(`awards|${id}|${pinHash}`).digest('base64url');
// A session never expires but is signed with the person's current PIN hash, so changing the PIN ends it.
export const issue = (user, secret) => `${user.id}.${sign(secret, user.id, user.pin_hash)}`;
function failure(code, message) { const e = Error(message); e.status = code; throw e; }
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
 const userOf = id => database('family_users').where({ id }).whereNot('status', 'disabled').first();
 // The signed-in person: the awards row plus their family_users row (name, PIN hash).
 const guestFor = async req => {
  const [id, sig, extra] = (req.get('X-Family-Session') || '').split('.');
  if (extra || !sig || !/^[\da-f-]{36}$/i.test(id)) failure(401, 'Scan your invitation to sign in.');
  const [g, user] = await Promise.all([database('family_award_guests').where({ user_id: id }).first(), userOf(id)]);
  const expected = g && user?.pin_hash ? sign(secret(), id, user.pin_hash) : '';
  if (!expected || expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) failure(401, 'Scan your invitation to sign in.');
  return { ...g, user };
 };
 const byToken = async k => {
  if (typeof k !== 'string' || !/^[\w-]{16,64}$/.test(k)) failure(404, 'This invitation link is not valid.');
  const g = await database('family_award_guests').where({ token_hash: sha(k) }).first();
  const user = g && await userOf(g.user_id);
  if (!user) failure(404, 'This invitation link is not valid.');
  return { ...g, user };
 };
 const first = u => u.first_name || u.name.split(' ')[0];

 router.get('/awards/invite', run(async (req, res) => {
  limited(req, 60);
  const { user: u } = await byToken(req.query.k);
  res.json({ name: u.name, first_name: first(u), hasPin: !!u.pin_hash,
   photo_url: u.photo ? `https://fam-api.xgold.tech/family/photos/${u.id}?v=${encodeURIComponent(u.photo)}` : null });
 }));
 // First visit with no family PIN yet: the passcode they enter becomes their family PIN. Otherwise it must match.
 router.post('/awards/claim', run(async (req, res) => {
  limited(req, 40);
  const g = await byToken(req.body?.k), pin = req.body?.pin;
  let u = g.user;
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) failure(400, 'Enter four digits.');
  if (g.locked_until && new Date(g.locked_until) > new Date()) failure(429, 'Too many wrong passcodes. Try again in 15 minutes.');
  const created = !u.pin_hash;
  if (created) {
   [u] = await database('family_users').where({ id: u.id }).whereNull('pin_hash').update({ pin_hash: familyHash(u.name, pin), pin_salt_name: u.name }).returning('*');
   if (!u) failure(409, 'A passcode was just set. Enter it to continue.');
  } else if (!timingSafeEqual(Buffer.from(u.pin_hash, 'hex'), Buffer.from(familyHash(u.pin_salt_name || '', pin), 'hex'))) {
   const failed = g.failed + 1;
   await database('family_award_guests').where({ user_id: g.user_id }).update(failed >= 5 ? { failed: 0, locked_until: new Date(Date.now() + 15 * 60000) } : { failed });
   failure(401, 'That passcode does not match.');
  }
  await database('family_award_guests').where({ user_id: g.user_id }).update({ failed: 0, locked_until: null });
  // Registered members also get the regular family session, so signing in here signs them in across the site.
  res.status(created ? 201 : 200).json({ session: issue(u, secret()), family: u.status === 'ready' ? options.familySession?.(u) : undefined, name: u.name });
 }));
 router.get('/awards/me', run(async (req, res) => {
  const g = await guestFor(req);
  const going = await database('family_award_guests as a').join('family_users as u', 'u.id', 'a.user_id').where('a.rsvp', true).orderBy('u.name').select('u.name');
  res.json({ name: g.user.name, first_name: first(g.user), admin: g.is_admin, rsvp: g.rsvp, ballot: g.ballot,
   upload: g.upload_name ? { name: g.upload_name, type: g.upload_type, at: g.upload_at } : null, going: going.map(r => r.name) });
 }));
 router.put('/awards/rsvp', run(async (req, res) => {
  const g = await guestFor(req);
  if (typeof req.body?.going !== 'boolean') failure(400, 'Choose yes or no.');
  await database('family_award_guests').where({ user_id: g.user_id }).update({ rsvp: req.body.going, rsvp_at: new Date() });
  res.json({ rsvp: req.body.going });
 }));
 // The ballot is one text answer per category, keyed by the category id from awards/event.json.
 router.put('/awards/ballot', run(async (req, res) => {
  const g = await guestFor(req), input = req.body?.ballot;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 40) failure(400, 'That ballot could not be read.');
  const ballot = {};
  for (const [id, v] of Object.entries(input)) {
   if (!/^[a-z0-9-]{1,40}$/.test(id) || typeof v !== 'string') failure(400, 'That ballot could not be read.');
   if (v.trim().length > 500) failure(400, 'Each answer can be up to 500 characters.');
   if (v.trim()) ballot[id] = v.trim();
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
 // The file itself: your own, or anyone's if you are the organizer.
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
   .select('a.user_id', 'u.name', 'a.rsvp', 'a.ballot', 'a.upload_name', 'u.pin_hash');
  res.json({ guests: rows.map(r => ({ id: r.user_id, name: r.name, rsvp: r.rsvp, ballot: r.ballot, upload: r.upload_name, joined: !!r.pin_hash })) });
 }));
}
