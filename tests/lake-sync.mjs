import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseIcs,awayFromEvents,calendarUrl} from '../deploy/family-hub/lake-sync.js';
const wrap=body=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
const event=(...lines)=>`BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT\r\n`;
test('all-day events: the end date is the day after the last day away',()=>{
 const events=parseIcs(wrap(event('SUMMARY:Travel: Denver','DTSTART;VALUE=DATE:20260710','DTEND;VALUE=DATE:20260713')+event('SUMMARY:Flight','DTSTART;VALUE=DATE:20260801')));
 assert.deepEqual(awayFromEvents(events,'2026-01-01').map(r=>[r.start_date,r.end_date,r.reason]),[['2026-07-10','2026-07-12','Travel: Denver'],['2026-08-01','2026-08-01','Flight']]);
});
test('timed events: the days they touch, local midnight ends the span, UTC reads on the Central clock',()=>{
 const rows=awayFromEvents(parseIcs(wrap(
  event('SUMMARY:Flight to Austin','DTSTART;TZID=America/Chicago:20260710T214500','DTEND;TZID=America/Chicago:20260711T003000')+
  event('SUMMARY:Vacation','DTSTART:20260720T050000Z','DTEND:20260723T000000')+
  event('SUMMARY:Trip home','DTSTART:20260801T020000Z','DTEND:20260801T030000Z'))),'2026-01-01');
 assert.deepEqual(rows.map(r=>[r.start_date,r.end_date]),[['2026-07-10','2026-07-11'],['2026-07-20','2026-07-22'],['2026-07-31','2026-07-31']]);
});
test('only travel titles count; cancelled, repeating, past and endless events are ignored',()=>{
 const events=parseIcs(wrap(
  event('SUMMARY:Dentist','DTSTART;VALUE=DATE:20260710','DTEND;VALUE=DATE:20260711')+
  event('SUMMARY:Travel (cancelled)','STATUS:CANCELLED','DTSTART;VALUE=DATE:20260712')+
  event('SUMMARY:Weekly travel day','RRULE:FREQ=WEEKLY','DTSTART;VALUE=DATE:20260713')+
  event('SUMMARY:Flight (old)','DTSTART;VALUE=DATE:20250101')+
  event('SUMMARY:Vacation year','DTSTART;VALUE=DATE:20260901','DTEND;VALUE=DATE:20270901')+
  event('SUMMARY:Travelogue night','DTSTART;VALUE=DATE:20260715')+
  event('SUMMARY:Out of town\\, back Friday','DTSTART;VALUE=DATE:20260720'))); 
 assert.deepEqual(awayFromEvents(events,'2026-06-01').map(r=>r.reason),['Out of town, back Friday']);
});
test('folded lines and long titles',()=>{
 const folded='SUMMARY:Travel to a very long named place that the calendar app wraps\r\n  across two lines';
 const [e]=parseIcs(wrap(event(folded,'DTSTART;VALUE=DATE:20260710')));
 assert.equal(e.summary,'Travel to a very long named place that the calendar app wraps across two lines');
 assert.equal(awayFromEvents([{...e,summary:'Travel '+'x'.repeat(200)}],'2026-01-01')[0].reason.length,120);
});
test('calendar links must be https to a named host',()=>{
 assert.equal(calendarUrl('webcal://p01-caldav.icloud.com/published/2/abc'),'https://p01-caldav.icloud.com/published/2/abc');
 assert.equal(calendarUrl(' https://calendar.google.com/calendar/ical/x%40gmail.com/private-1/basic.ics ').startsWith('https://calendar.google.com/'),true);
 for(const bad of ['http://a.example.com/x','https://10.0.0.5/x','https://192.168.1.148/x','https://localhost/x','https://[::1]/x','https://u:p@a.example.com/x','ftp://a.example.com/x','','x'.repeat(10)])assert.equal(calendarUrl(bad),null,bad);
});
