import { buildIcs } from './calendar.js';
const SITE = 'https://fam.xgold.tech';
const ymd = d => typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const day = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const range = r => `${day(ymd(r.start_date))} to ${day(ymd(r.end_date))}`;
const clock = t => { const [h, m] = String(t).split(':'); return `${(h % 12) || 12}:${m} ${h < 12 ? 'am' : 'pm'}`; };
const who = r => r.title || r.guest_name || 'A guest';
const stayIcs = r => buildIcs('6108', [{ uid: `stay-${r.id}@fam.xgold.tech`, start: ymd(r.start_date), end: ymd(r.end_date), sequence: r.revision, summary: '6108 · ' + who(r) }]);
// The mails one event produces. ctx: { property, managers: [email], memberEmail, link } (link only on a visitor's first request).
// Plain text, one idea per mail; a confirmed stay carries a calendar file.
export function compose(event, r, ctx) {
 const out = [], guest = r.guest_email || ctx.memberEmail, p = ctx.property || {}, when = range(r);
 const times = p.check_in ? `Check-in ${clock(p.check_in)}, check-out ${clock(p.check_out)}.` : '';
 const to = (address, subject, lines, ics) => address && out.push({ to: address, subject, text: lines.filter(Boolean).join('\n\n') + '\n', ...(ics ? { ics } : {}) });
 const managers = (subject, line) => ctx.managers.forEach(a => to(a, subject, [line, `Open the 6108 page: ${SITE}/6108/`]));
 const confirmed = (subject, line) => to(guest, subject, [line, times], stayIcs(r));
 if (event === 'requested' && r.status === 'confirmed') confirmed(`Confirmed: 6108, ${when}`, 'Your stay is confirmed.');
 else if (event === 'requested' && r.status === 'pending') {
  to(guest, `Request received: 6108, ${when}`, ['Carter or Chester will confirm it soon.', ctx.link && `Change or cancel it here: ${ctx.link}`]);
  managers(`New request: ${who(r)}, ${when}`, `${who(r)} asked for 6108, ${when}.`);
 } else if (event === 'confirmed') confirmed(`Confirmed: 6108, ${when}`, 'Your stay is confirmed.');
 else if (event === 'declined') to(guest, `Not available: 6108, ${when}`, ['Those dates did not work out. You are welcome to request other dates.']);
 else if (event === 'cancelled') to(guest, `Cancelled: 6108, ${when}`, ['This stay was cancelled.']);
 else if (event === 'changed') to(guest, `Updated: 6108, ${when}`, ['Your stay was updated.', times], r.status === 'confirmed' ? stayIcs(r) : undefined);
 else if (event === 'guest-cancelled') { to(guest, `Cancelled: 6108, ${when}`, ['Your stay is cancelled.']); managers(`Cancelled by guest: ${who(r)}, ${when}`, `${who(r)} cancelled 6108, ${when}.`); }
 else if (event === 'guest-rescheduled') { to(guest, `Change requested: 6108, ${when}`, ['Your new dates are waiting for Carter or Chester to confirm.']); managers(`Change requested: ${who(r)}, ${when}`, `${who(r)} asked to move to ${when}. It needs approval again.`); }
 else if (event === 'reminder') to(guest, `Coming up: 6108, ${when}`, [`Your stay starts ${day(ymd(r.start_date))}.`, times], stayIcs(r));
 return out;
}
const ready = async database => database('family_users').where({ condo_manager: true, status: 'ready' }).pluck('email');
async function context(database, r, link) {
 const [property, managers, member] = await Promise.all([database('family_properties').where({ id: '6108' }).first('check_in', 'check_out'), ready(database), r.user_id ? database('family_users').where({ id: r.user_id }).first('email') : null]);
 return { property, managers: managers.filter(Boolean), memberEmail: member?.email || '', link };
}
// Email goes out only when the family Directus has a real transport configured (EMAIL_TRANSPORT other than sendmail, plus its settings).
// shortcut: no queue or retry; a failed send is logged and the booking stands. Add a queue if mail gets important.
export function notifier({ database, services, getSchema, env = {}, logger, send }) {
 const configured = !!env.EMAIL_TRANSPORT && env.EMAIL_TRANSPORT !== 'sendmail';
 let mail;
 const deliver = send || (async m => {
  mail ||= new services.MailService({ schema: await getSchema() });
  await mail.send({ to: m.to, subject: m.subject, text: m.text, attachments: m.ics ? [{ filename: '6108.ics', content: m.ics, contentType: 'text/calendar' }] : undefined });
 });
 const dispatch = async mails => { for (const m of mails) { try { await deliver(m); } catch (e) { logger?.warn?.(`6108 email to ${m.to} failed: ${e.message}`); } } };
 const notify = async (event, row, token) => {
  if (!configured && !send) return;
  try { await dispatch(compose(event, row, await context(database, row, token ? `${SITE}/6108/?stay=${token}` : ''))); } catch (e) { logger?.warn?.('6108 notification failed: ' + e.message); }
 };
 // Confirmed stays starting within a week get one reminder, then reminded_at stops a repeat.
 notify.reminders = async (now = new Date()) => {
  if (!configured && !send) return 0;
  const p = await database('family_properties').where({ id: '6108' }).first('timezone', 'check_in', 'check_out');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: p.timezone }).format(now), soon = new Date(today + 'T12:00:00Z');
  soon.setUTCDate(soon.getUTCDate() + 7);
  const due = await database('family_reservations').where({ status: 'confirmed', reminded_at: null }).where('start_date', '>=', today).where('start_date', '<=', soon.toISOString().slice(0, 10));
  for (const r of due) {
   const member = r.user_id ? await database('family_users').where({ id: r.user_id }).first('email') : null;
   await dispatch(compose('reminder', r, { property: p, managers: [], memberEmail: member?.email || '' }));
   await database('family_reservations').where({ id: r.id }).update({ reminded_at: now });
  }
  return due.length;
 };
 return notify;
}
// Checks for due reminders every six hours while the family Directus runs; one timer however often the module loads.
export function startReminders(notify, logger) {
 if (globalThis.__familyReminders) return;
 const run = () => notify.reminders().catch(e => logger?.warn?.('6108 reminders failed: ' + e.message));
 globalThis.__familyReminders = setInterval(run, 6 * 3600 * 1000);
 globalThis.__familyReminders.unref?.();
 setTimeout(run, 60000).unref?.();
}
