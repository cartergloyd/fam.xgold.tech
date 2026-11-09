// Builds .ics files in the browser: "Add to calendar" for a stay or the trip. The subscribe feed is built the same way in
// deploy/family-hub/calendar.js; tests/calendar-ics.mjs checks the two agree.
(() => {
 const esc = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
 // shortcut: folds by characters, so an emoji pair could split; names and titles here are plain text.
 const fold = line => { const out = []; let s = line; while (new TextEncoder().encode(s).length > 75) { let cut = 75; while (new TextEncoder().encode(s.slice(0, cut)).length > 75) cut--; out.push(s.slice(0, cut)); s = ' ' + s.slice(cut); } out.push(s); return out.join('\r\n'); };
 const stamp = d => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
 // 'YYYY-MM-DD' is an all-day date (end is exclusive); 'YYYY-MM-DDTHH:MM' is a clock time with no zone, so it reads the same wherever the calendar is.
 const when = (key, value) => value.length > 10 ? `${key}:${value.replace(/[-:]/g, '')}00` : `${key};VALUE=DATE:${value.replace(/-/g, '')}`;
 const plusHour = v => { const d = new Date(v + ':00Z'); d.setUTCHours(d.getUTCHours() + 1); return d.toISOString().slice(0, 16); };
 const nextDay = v => { const d = new Date(v + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
 // event: { uid, summary, start, end?, description?, location?, status?: 'CONFIRMED'|'TENTATIVE', sequence? }
 function build(name, events, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fam.xgold.tech//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + esc(name)];
  for (const e of events) {
   const end = e.end || (e.start.length > 10 ? plusHour(e.start) : nextDay(e.start));
   lines.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:' + stamp(now), when('DTSTART', e.start), when('DTEND', end), 'SUMMARY:' + esc(e.summary), 'STATUS:' + (e.status || 'CONFIRMED'), 'SEQUENCE:' + (e.sequence || 0), 'TRANSP:TRANSPARENT');
   if (e.description) lines.push('DESCRIPTION:' + esc(e.description));
   if (e.location) lines.push('LOCATION:' + esc(e.location));
   lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
 }
 function download(filename, name, events) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([build(name, events)], { type: 'text/calendar' }));
  a.download = filename;
  document.body.append(a);a.click();a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
 }
 window.famIcs = { build, download };
})();
