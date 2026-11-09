// Chester's calendar -> Away days. He pastes a read-only calendar link (Google "secret address in iCal format", iCloud or Outlook.com
// public link); events whose title says travel become Away ranges. Ranges from the link are marked source 'calendar' and replaced on each
// sync; ranges typed on the page stay.
const TRAVEL = /\b(travel|flight|trip|out of town|vacation)\b/i;
const MAX_BYTES = 2_000_000, MAX_DAYS = 60, MAX_RANGES = 200;
const ymd = v => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const unescape = v => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
// A time ending in Z is UTC; it is read as a date on the property's clock so a late flight lands on the right day.
function localDay(value, zone) {
 if (!/T\d{6}Z$/.test(value)) return ymd(value);
 const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8), +value.slice(9, 11), +value.slice(11, 13), +value.slice(13, 15)));
 return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(d);
}
// shortcut: repeating events (RRULE) are skipped and other zones' clock times are read as written; upgrade if recurring travel matters.
export function parseIcs(text, zone = 'America/Chicago') {
 const events = [];let cur = null;
 for (const line of text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')) {
  if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
  if (line === 'END:VEVENT') { if (cur?.start && !cur.recurs && cur.status !== 'CANCELLED') events.push(cur); cur = null; continue; }
  const i = line.indexOf(':');if (!cur || i < 0) continue;
  const [name, ...params] = line.slice(0, i).split(';'), value = line.slice(i + 1).trim();
  const key = name.toUpperCase();
  if (key === 'SUMMARY') cur.summary = unescape(value);
  else if (key === 'STATUS') cur.status = value.toUpperCase();
  else if (key === 'RRULE') cur.recurs = true;
  else if (key === 'DTSTART' && /^\d{8}/.test(value)) { cur.start = localDay(value, zone); cur.allDay = /^\d{8}$/.test(value) || params.some(p => /^VALUE=DATE$/i.test(p)); }
  else if (key === 'DTEND' && /^\d{8}/.test(value)) { cur.end = localDay(value, zone); cur.endMidnight = /^\d{8}$/.test(value) || /T000000$/.test(value); }
 }
 return events;
}
// Travel events still on or after today, as inclusive date ranges.
export function awayFromEvents(events, today) {
 const out = new Map();
 for (const e of events) {
  if (!TRAVEL.test(e.summary || '')) continue;
  // An end at midnight (every all-day event) is the day after the last day away.
  let end = e.end ? (e.endMidnight ? addDays(e.end, -1) : e.end) : e.start;
  if (end < e.start) end = e.start;
  if (end < today || (Date.parse(end) - Date.parse(e.start)) / 86400000 > MAX_DAYS) continue;
  out.set(e.start + end, { start_date: e.start, end_date: end, reason: e.summary.trim().slice(0, 120) });
 }
 return [...out.values()].sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, MAX_RANGES);
}
// An https link to a named host, so a pasted value cannot point the server at an address inside the house.
export function calendarUrl(value) {
 let u;try { u = new URL(String(value || '').trim().replace(/^webcal:/i, 'https:')); } catch { return null; }
 if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':') || u.href.length > 2000) return null;
 return u.href;
}
export async function fetchCalendar(url) {
 const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
 if (!res.ok) throw Error(`The calendar link answered ${res.status}.`);
 if (Number(res.headers.get('content-length')) > MAX_BYTES) throw Error('That calendar is too large.');
 const text = await res.text();
 if (text.length > MAX_BYTES) throw Error('That calendar is too large.');
 return text;
}
const todayIn = zone => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
// Reads the link and swaps the owner's calendar-sourced Away ranges for what it holds now. Throws if the link cannot be read.
export async function applyCalendar({ database, owner, url, fetchText = fetchCalendar }) {
 const { timezone } = await database('family_properties').where({ id: '6108' }).first('timezone');
 const text = await fetchText(url), today = todayIn(timezone);
 if (!text.trimStart().startsWith('BEGIN:VCALENDAR')) throw Error('That link is not a calendar.');
 const ranges = awayFromEvents(parseIcs(text, timezone), today);
 await database.transaction(async trx => {
  await trx('family_lake_away').where({ user_id: owner.id, source: 'calendar' }).where('end_date', '>=', today).del();
  if (ranges.length) await trx('family_lake_away').insert(ranges.map(r => ({ user_id: owner.id, ...r, source: 'calendar' })));
 });
 return ranges.length;
}
// Re-reads the saved link; the outcome is stored beside it so the page can show when it last worked.
export async function syncOwner({ database, fetchText }) {
 const owner = await database('family_users').where({ lake_owner: true }).first('id');
 const cal = owner && await database('family_lake_calendar').where({ user_id: owner.id }).first();
 if (!cal) return null;
 try { const count = await applyCalendar({ database, owner, url: cal.url, fetchText }); await database('family_lake_calendar').where({ user_id: owner.id }).update({ synced_at: new Date(), error: '' }); return count; }
 catch (e) { await database('family_lake_calendar').where({ user_id: owner.id }).update({ error: String(e.message).slice(0, 200) }); return null; }
}
// Every six hours while the family Directus runs; one timer however often the module loads.
export function startSync(database, fetchText) {
 if (globalThis.__lakeSync) return;
 globalThis.__lakeSync = setInterval(() => syncOwner({ database, fetchText }).catch(() => {}), 6 * 3600 * 1000);
 globalThis.__lakeSync.unref?.();
}
