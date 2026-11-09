import { createHmac, timingSafeEqual } from 'node:crypto';
import { sessionUser } from './hub-session.js';
const ymd = d => typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const nextDay = s => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
// Same builder as ics.js in the site (the browser's "Add to calendar"); tests/calendar-ics.mjs checks the two agree. All-day events only here.
const esc = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
// shortcut: folds by characters, so an emoji pair could split; names and titles here are plain text.
const fold = line => { const out = []; let s = line; while (Buffer.byteLength(s) > 75) { let cut = 75; while (Buffer.byteLength(s.slice(0, cut)) > 75) cut--; out.push(s.slice(0, cut)); s = ' ' + s.slice(cut); } out.push(s); return out.join('\r\n'); };
const stamp = d => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
const date = (key, v) => `${key};VALUE=DATE:${v.replace(/-/g, '')}`;
export function buildIcs(name, events, now = new Date()) {
 const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fam.xgold.tech//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + esc(name), 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
 for (const e of events) lines.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:' + stamp(now), date('DTSTART', e.start), date('DTEND', e.end || nextDay(e.start)), 'SUMMARY:' + esc(e.summary), 'STATUS:' + (e.status || 'CONFIRMED'), 'SEQUENCE:' + (e.sequence || 0), 'TRANSP:TRANSPARENT', 'END:VEVENT');
 lines.push('END:VCALENDAR');
 return lines.map(fold).join('\r\n') + '\r\n';
}
// A private link per member: HMAC of their id and PIN hash, so changing the PIN revokes it, like a session.
const mac = (secret, user) => createHmac('sha256', secret).update('calendar-feed:' + user.id + ':' + user.pin_hash).digest('base64url');
export const feedToken = (user, secret) => user.id + '.' + mac(secret, user);
export async function feedUser(database, token, secret) {
 const [id, sig, ...extra] = String(token || '').split('.');
 if (!secret || extra.length || !sig || !/^[\da-f-]{36}$/i.test(id || '')) return null;
 const user = await database('family_users').where({ id, status: 'ready' }).first();
 if (!user) return null;
 const given = Buffer.from(sig), expected = Buffer.from(mac(secret, user));
 return given.length === expected.length && timingSafeEqual(given, expected) ? user : null;
}
// Stays as all-day events. A reservation's end date is the checkout day, which is also the exclusive end of an all-day event.
export function stayEvents(rows) {
 return rows.map(r => ({
  uid: `stay-${r.id}@fam.xgold.tech`, start: ymd(r.start_date), end: ymd(r.end_date), sequence: r.revision,
  summary: r.status === 'blocked' ? '6108 · Unavailable' : `6108 · ${r.status === 'pending' ? 'Requested: ' : ''}${r.title || r.name || 'Stay'}`,
  status: r.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED',
 }));
}
export const awayEvents = rows => rows.map(r => ({ uid: `away-${r.id}@fam.xgold.tech`, start: ymd(r.start_date), end: nextDay(ymd(r.end_date)), summary: 'Away' + (r.reason ? ': ' + r.reason : '') }));
export default function calendar(router, { database }, options = {}) {
 const secret = options.secret || process.env.SECRET;
 const fail = (res, code, error) => res.status(code).json({ error });
 // The signed-in page asks for its member's link; the calendar app then fetches the feed with it, no session header.
 router.get('/hub/calendar-link', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
   const u = await sessionUser(database, req.get('X-Family-Session') || '', secret);
   if (!u) return fail(res, 401, 'Sign in with your email and PIN to continue.');
   res.json({ token: feedToken(u, secret) });
  } catch { fail(res, 503, 'The calendar link is temporarily unavailable. Please try again.'); }
 });
 router.get('/hub/calendar.ics', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300');
  try {
   const u = await feedUser(database, req.query?.k, secret);
   if (!u) return fail(res, 401, 'This calendar link is not valid. Get a new one from the 6108 page.');
   const rows = await database('family_reservations as r').leftJoin('family_users as u', 'r.user_id', 'u.id').where('r.property_id', '6108').whereIn('r.status', ['pending', 'confirmed', 'blocked']).orderBy('r.start_date')
    .select('r.id', 'r.start_date', 'r.end_date', 'r.status', 'r.title', 'r.revision', database.raw('coalesce(u.name, r.guest_name) as name'));
   const events = stayEvents(rows);
   if (u.lake_schedule) {
    const owner = await database('family_users').where({ lake_owner: true }).first('id');
    if (owner) events.push(...awayEvents(await database('family_lake_away').where({ user_id: owner.id }).orderBy('start_date')));
   }
   res.type('text/calendar; charset=utf-8').send(buildIcs('6108', events));
  } catch { fail(res, 503, 'The calendar is temporarily unavailable. Please try again.'); }
 });
}
