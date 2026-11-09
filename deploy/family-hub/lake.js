import { sessionUser } from './hub-session.js';
import { applyCalendar, calendarUrl, startSync } from './lake-sync.js';
const ORIGIN = 'https://fam.xgold.tech';
const ymd = d => typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const validDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '2000-01-01' && s <= '2100-12-31' && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
const isFriday = s => new Date(s + 'T12:00:00Z').getUTCDay() === 5;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function failure(code, message) { const e = Error(message); e.status = code; throw e; }
const text = (v, max, what) => { v ??= ''; if (typeof v !== 'string' || v.trim().length > max) failure(400, `${what} can be up to ${max} characters.`); return v.trim(); };
const names = (v, what) => { v ??= []; if (!Array.isArray(v) || v.length > 10 || v.some(n => typeof n !== 'string' || !n.trim() || n.trim().length > 60)) failure(400, `${what}: up to 10 names, 60 characters each.`); return v.map(n => n.trim()); };
const fridays = v => { if (!Array.isArray(v) || v.length > 60 || v.some(f => !validDay(f) || !isFriday(f))) failure(400, 'Weekends are Fridays.'); return [...new Set(v)].sort(); };
const weekend = r => ({ friday: ymd(r.friday), title: r.title, notes: r.notes, notes_9112: r.notes_9112, queen: r.queen, bunks: r.bunks, revision: r.revision });
const away = r => ({ id: r.id, start_date: ymd(r.start_date), end_date: ymd(r.end_date), reason: r.reason, source: r.source || 'manual' });
const invite = r => ({ id: r.id, group: r.group_no, name: r.name, note: r.note, weekends: r.weekends });
const MAX_AWAY = 500, MAX_INVITES = 200;
// The lake schedule (days at the lake, away ranges, weekends, invite list) for the 6108 page. One schedule, owned by the
// user flagged lake_owner; anyone flagged lake_schedule reads and writes it.
export default function lake(router, { database }, options = {}) {
 const run = fn => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
   if (req.method !== 'GET' && req.get('Origin') !== ORIGIN) failure(403, 'Please use the family website.');
   const u = await sessionUser(database, req.get('X-Family-Session') || '', options.secret || process.env.SECRET);
   if (!u) failure(401, 'Sign in with your email and PIN to continue.');
   if (!u.lake_schedule) failure(403, 'The lake schedule is private to its owner.');
   const owner = await database('family_users').where({ lake_owner: true }).first('id', 'name');
   if (!owner) failure(503, 'The lake schedule has no owner yet.');
   await fn(req, res, owner);
  } catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'The lake schedule is temporarily unavailable. Please try again.' }); }
 };
 if (options.timers !== false) startSync(database, options.fetchText);
 const count = async (table, o) => Number((await database(table).where({ user_id: o.id }).count('* as n').first()).n);
 const uuid = id => { if (!UUID.test(id)) failure(404, 'Not found.'); return id; };
 router.get('/hub/lake', run(async (_req, res, o) => {
  const mine = table => database(table).where({ user_id: o.id });
  const [days, weekends, aways, invites, cal] = await Promise.all([mine('family_lake_days').orderBy('day').select('day', 'presence'), mine('family_lake_weekends').orderBy('friday'), mine('family_lake_away').orderBy('start_date'), mine('family_lake_invites').orderBy('position'), mine('family_lake_calendar').first('synced_at', 'error')]);
  // The link itself is a secret, so the page only learns whether one is saved and how the last read went.
  res.json({ owner: o.name, days: days.map(d => ({ day: ymd(d.day), presence: d.presence })), weekends: weekends.map(weekend), away: aways.map(away), invites: invites.map(invite), calendar: cal ? { linked: true, synced_at: cal.synced_at || null, error: cal.error || '' } : { linked: false } });
 }));
 router.put('/hub/lake/days/:day', run(async (req, res, o) => {
  const day = req.params.day, presence = req.body?.presence;
  if (!validDay(day)) failure(400, 'Choose a valid day.');
  if (presence === null) await database('family_lake_days').where({ user_id: o.id, day }).del();
  else if (presence === 'yes' || presence === 'no') await database('family_lake_days').insert({ user_id: o.id, day, presence }).onConflict(['user_id', 'day']).merge();
  else failure(400, 'Mark the day at the lake or not at the lake, or clear it.');
  res.json({ day, presence });
 }));
 // shortcut: weekends are last-write-wins (no revision check); one schedule with two editors, add the check if they collide.
 router.put('/hub/lake/weekends/:friday', run(async (req, res, o) => {
  const friday = req.params.friday, b = req.body || {};
  if (!validDay(friday) || !isFriday(friday)) failure(400, 'Weekends are keyed by their Friday.');
  const values = { title: text(b.title, 80, 'Title'), notes: text(b.notes, 2000, 'Notes'), notes_9112: text(b.notes_9112, 2000, '9112 notes'), queen: JSON.stringify(names(b.queen, 'Queen Suite')), bunks: JSON.stringify(names(b.bunks, 'Bunkbeds')) };
  const [row] = await database('family_lake_weekends').insert({ user_id: o.id, friday, ...values }).onConflict(['user_id', 'friday']).merge({ ...values, revision: database.raw('family_lake_weekends.revision + 1') }).returning('*');
  res.json({ weekend: weekend(row) });
 }));
 router.post('/hub/lake/away', run(async (req, res, o) => {
  const b = req.body || {};
  if (!validDay(b.start_date) || !validDay(b.end_date) || b.end_date < b.start_date || (Date.parse(b.end_date) - Date.parse(b.start_date)) / 86400000 > 366) failure(400, 'Choose a first and last day, in order.');
  const reason = text(b.reason, 120, 'Reason');
  if (await count('family_lake_away', o) >= MAX_AWAY) failure(429, 'That is a lot of away dates. Remove a few first.');
  const [row] = await database('family_lake_away').insert({ user_id: o.id, start_date: b.start_date, end_date: b.end_date, reason }).returning('*');
  res.status(201).json({ away: away(row) });
 }));
 router.delete('/hub/lake/away/:id', run(async (req, res, o) => {
  if (!await database('family_lake_away').where({ id: uuid(req.params.id), user_id: o.id }).del()) failure(404, 'Not found.');
  res.json({ deleted: true });
 }));
 router.post('/hub/lake/invites', run(async (req, res, o) => {
  const b = req.body || {}, name = text(b.name, 80, 'Name');
  if (!name) failure(400, 'Add a name.');
  if (await count('family_lake_invites', o) >= MAX_INVITES) failure(429, 'The invite list is full.');
  const last = await database('family_lake_invites').where({ user_id: o.id }).max('position as p').first();
  const [row] = await database('family_lake_invites').insert({ user_id: o.id, name, note: text(b.note, 400, 'Note'), position: (last?.p ?? -1) + 1 }).returning('*');
  res.status(201).json({ invite: invite(row) });
 }));
 router.patch('/hub/lake/invites/:id', run(async (req, res, o) => {
  const b = req.body || {}, changes = {};
  if (b.name !== undefined) { changes.name = text(b.name, 80, 'Name'); if (!changes.name) failure(400, 'Add a name.'); }
  if (b.note !== undefined) changes.note = text(b.note, 400, 'Note');
  if (b.weekends !== undefined) changes.weekends = JSON.stringify(fridays(b.weekends));
  if (!Object.keys(changes).length) failure(400, 'Nothing to change.');
  const [row] = await database('family_lake_invites').where({ id: uuid(req.params.id), user_id: o.id }).update(changes).returning('*');
  if (!row) failure(404, 'Not found.');
  res.json({ invite: invite(row) });
 }));
 router.delete('/hub/lake/invites/:id', run(async (req, res, o) => {
  if (!await database('family_lake_invites').where({ id: uuid(req.params.id), user_id: o.id }).del()) failure(404, 'Not found.');
  res.json({ deleted: true });
 }));
 // The link is read before it is saved, so a typo never replaces a working one. Reading it also refreshes the calendar-sourced Away ranges.
 router.put('/hub/lake/calendar', run(async (req, res, o) => {
  const url = calendarUrl(req.body?.url);
  if (!url) failure(400, 'Paste the calendar link. It starts with https:// or webcal://.');
  let count;
  try { count = await applyCalendar({ database, owner: o, url, fetchText: options.fetchText }); } catch (e) { failure(400, 'Could not read that calendar. ' + e.message); }
  const synced_at = new Date();
  await database('family_lake_calendar').insert({ user_id: o.id, url, synced_at, error: '' }).onConflict('user_id').merge();
  res.json({ calendar: { linked: true, synced_at, error: '' }, count });
 }));
 router.delete('/hub/lake/calendar', run(async (_req, res, o) => {
  await database('family_lake_calendar').where({ user_id: o.id }).del();
  await database('family_lake_away').where({ user_id: o.id, source: 'calendar' }).del();
  res.json({ deleted: true });
 }));
}
