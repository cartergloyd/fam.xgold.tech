(() => {
 const H=window.familyHub,{$,api,node,notice}=H;
 const form=$('booking-form');let state,month=new Date(),selected=null,propertyDirty=false,propertyRevision;
 month=new Date(month.getFullYear(),month.getMonth(),1);
 const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const date=d=>new Date(d+'T12:00:00');
 const fmt=d=>date(d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
 const SUITES={master:'Master Suite',disney:'Disney Suite'},LAKE_SUITES={queen:'Queen Suite',bunks:'Bunkbeds'},ALL_SUITES={...SUITES,...LAKE_SUITES};let suitesFor;
 const nameField=(suite,value='')=>{const input=node('input');input.type='text';input.maxLength=60;input.autocomplete='off';input.placeholder='Guest';input.value=value;input.setAttribute('aria-label',ALL_SUITES[suite]+' guest');return input;};
 const suiteNames=(suite,root=form)=>[...root.querySelectorAll(`[data-suite=${suite}] input`)].map(i=>i.value.trim()).filter(Boolean);
 const firstName=s=>String(s||'').trim().split(/\s+/)[0]||'';
 // One field per suite to start. A member's own name leads the Master Suite; the schedule owner books for others, so nothing is prefilled.
 function renderSuites(){for(const suite of Object.keys(ALL_SUITES)){const list=form.querySelector(`[data-suite=${suite}] .names`);const lead=suite==='master'&&!state.user?.lake_schedule?state.user?.name||'':'';list.replaceChildren(nameField(suite,lead));if(lead)list.append(nameField(suite));}}
 document.addEventListener('input',e=>{const input=e.target,list=input.parentElement;if(!(input instanceof HTMLInputElement)||!input.matches('.names input'))return;if(input===list.lastElementChild&&input.value.trim()&&list.children.length<10)list.append(nameField(list.parentElement.dataset.suite));});
 const todayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:state.property.timezone}).format(new Date());
 const occupied=d=>state.reservations.find(r=>['pending','confirmed','blocked'].includes(r.status)&&r.start_date<=d&&r.end_date>d);
 function calendar(){
  $('calendar-title').textContent=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const body=$('calendar-days');body.replaceChildren();const first=month.getDay(),days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const today=todayKey();
  let row;
  for(let i=0;i<Math.ceil((first+days)/7)*7;i++){
   if(i%7===0){row=node('tr');body.append(row);}const cell=node('td');row.append(cell);
   // Out-of-range day numbers roll into the neighbouring months, which render muted.
   const d=new Date(month.getFullYear(),month.getMonth(),i-first+1),key=iso(d),r=occupied(key),button=node('button',String(d.getDate()));button.type='button';
   button.classList.toggle('other',d.getMonth()!==month.getMonth());
   const presence=presenceOf(key);if(LAKE_CLASS[presence]){button.classList.add(LAKE_CLASS[presence]);if(presence!=='away'){const who=node('img',undefined,'who');who.alt='';who.src=window.familyAccount.photo(state.user.name);button.append(who);}}
   const past=key<today,sel=(awayMode?awayForm:form).elements;button.disabled=past&&!marking&&!(awayMode?awayFor(key):r);button.classList.toggle('past',past);button.classList.toggle('busy',!!r);button.classList.toggle('selected',key===sel.start_date.value||key===sel.end_date.value||(key>sel.start_date.value&&key<sel.end_date.value));
   button.setAttribute('aria-pressed',button.classList.contains('selected')?'true':'false');
   button.setAttribute('aria-label',d.toLocaleDateString(undefined,{dateStyle:'full'})+(r?`, ${r.status==='blocked'?'unavailable':r.status+' stay'}`:', available')+(LAKE_LABEL[presence]?', '+LAKE_LABEL[presence]:''));
   if(r){let label=r.status==='pending'?'Requested':r.status==='blocked'?'Blocked':'Booked';if(lake&&r.status!=='blocked')label=r.title||firstName(r.suites?.master?.[0]||r.name)||label;button.append(node('small',label));}else if(presence==='away'&&awayFor(key)?.reason)button.append(node('small',awayFor(key).reason));
   if(lake&&[5,6,0].includes(d.getDay())){const w=lake.weekends[fridayOf(key)],who=[...(w?.queen||[]),...(w?.bunks||[])].map(firstName).filter(Boolean),line=who.length?who.join(', '):w?.notes_9112||'';if(line&&line!==button.querySelector('small')?.textContent)button.append(node('small',line,'nine'));}
   button.addEventListener('click',()=>{
    if(marking){H.action(button,()=>setPresence(key));return;}
    if(awayMode){
     const a=awayFor(key);if(a&&(!awaySel||key<=awaySel)){showAway(a);return;}
     if(past)return;if(awayOpen)newAway();
     if(!awaySel||key<=awaySel){awaySel=key;awayForm.elements.start_date.value=key;awayForm.elements.end_date.value='';}else{awayForm.elements.end_date.value=key;awaySel=null;}calendar();return;
    }
    // A stay opens in the form. Once a check-in is chosen, a later day still completes the range (a held start date works as checkout).
    if(r&&(!selected||key<=selected)){showStay(r);return;}
    if(past)return;
    if(viewing&&!editing)newBooking();
    if(!selected||key<=selected){selected=key;form.elements.start_date.value=key;form.elements.end_date.value='';}
    else{form.elements.end_date.value=key;selected=null;}updateSelection();
   });cell.append(button);
  }
 }
 function updateSelection(){
  const start=form.elements.start_date.value,end=form.elements.end_date.value,days=(Date.parse(end)-Date.parse(start))/86400000;
  form.elements.end_date.min=start||form.elements.start_date.min;
  let message=days>0?`${days} night${days===1?'':'s'}`:'Choose check-in and check-out dates.';
  const conflict=state.reservations.some(r=>!same(r)&&['pending','confirmed','blocked'].includes(r.status)&&start<r.end_date&&end>r.start_date);
  if(conflict&&days>0)message='Your selected stay overlaps held dates. Choose another range.';
  if(viewing&&!editing&&viewing.name&&viewing.name!==viewing.title&&!Object.values(viewing.suites||{}).some(n=>n?.length))message+=' · Booked by '+viewing.name;
  $('stay-summary').textContent=message;calendar();
 }
 async function loadAccess(){
  const {users}=await api('/hub/booking-access');const list=$('booking-access');list.replaceChildren();
  for(const u of users){const label=node('label',undefined,'check');label.append(node('span',u.name+(u.condo_manager?' · Manager':'')));const input=node('input');input.type='checkbox';input.checked=u.instant_booking;input.disabled=u.condo_manager;
   input.addEventListener('change',async()=>{const value=input.checked;input.disabled=true;try{await api('/hub/booking-access/'+u.id,{method:'PATCH',body:{instant_booking:value}});notice('page-message','Booking access updated for '+u.name+'.');}catch(e){input.checked=!value;notice('page-message',e.message,true);}finally{input.disabled=false;}});label.append(input);list.append(label);}
 }
 async function refresh(signed){
  // Visitors without an account get dates and status only; members get the full picture.
  state=signed?await api('/hub/condo'):{user:null,tasks:[],...await api('/hub/availability',{anonymous:true})};
  const user=state.user;H.user=user;
  lake=user?.lake_schedule?await api('/hub/lake'):null;
  if(lake){lake.days=Object.fromEntries(lake.days.map(d=>[d.day,d.presence]));lake.weekends=Object.fromEntries(lake.weekends.map(w=>[w.friday,w]));lake.away=lake.away||[];}
  for(const id of ['lake-tabs','mark-days','lake-fields','book-there'])$(id).hidden=!lake;if(lake)$('book-there').querySelector('span').textContent=firstName(user.name)+' will be there';if(!lake)document.querySelector('#lake-tabs [data-tab=calendar]').click();document.querySelectorAll('.legend .key-here,.legend .key-away').forEach(e=>e.hidden=!lake);
  document.querySelector('family-ribbon').hidden=!user;$('signin-link').hidden=!!user;
  $('property-title').textContent=state.property.title;$('maintenance-tab').hidden=!user;$('manage-tab').hidden=!user?.condo_manager;
  const open=document.querySelector('#section-tabs [aria-pressed=true]');if(open?.hidden)document.querySelector('[data-tab=details]').click();
  form.elements.start_date.min=todayKey();
  const uid=user?.id||null;if(suitesFor!==uid){suitesFor=uid;newBooking();}
  else if(viewing){const r=state.reservations.find(same);if(!r)newBooking();else{viewing=r;if(!editing)showStay(r);}}else setMode();
  $('property-description').textContent=state.property.description||'No property details yet.';
  $('property-rules').textContent=state.property.house_rules||'No house rules yet.';
  if(user?.condo_manager){if(!propertyDirty){propertyRevision=state.property.revision;for(const k of ['title','description','house_rules','max_guests','max_nights','advance_days','timezone'])$('property-form').elements[k].value=state.property[k]??'';}await loadAccess();}
  updateSelection();if(user)H.board('maintenance-board',state.tasks,'maintenance',user);
  if(!document.activeElement?.closest('#invite-list'))invites();
 }
 $('prev-month').addEventListener('click',()=>{month.setMonth(month.getMonth()-1);calendar();});$('next-month').addEventListener('click',()=>{month.setMonth(month.getMonth()+1);calendar();});
 for(const k of ['start_date','end_date'])form.elements[k].addEventListener('change',()=>{selected=null;updateSelection();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(viewing&&!editing)return;const suites={master:suiteNames('master'),disney:suiteNames('disney')},guests=suites.master.length+suites.disney.length;
  if(!guests){notice('booking-message','Add at least one guest name.',true);return;}
  const b=$('book-submit');b.disabled=true;notice('booking-message','Saving…');
  const body={start_date:form.elements.start_date.value,end_date:form.elements.end_date.value,title:form.elements.title.value.trim(),guests,suites,note:form.elements.note.value};
  try{const {reservation}=editing?await api('/hub/reservations/'+viewing.id,{method:'PATCH',body:{...body,revision:viewing.revision}}):await api('/hub/reservations',{method:'POST',body,anonymous:!state.user});
   if(lake){
    // The owner's stays record whether he will be there each night; the box starts checked. An edit only rewrites nights when the box changed.
    const want=form.elements.there.checked;
    if(!editing||want!==thereInitial)for(const k of nightsOf(body.start_date,body.end_date)){const cur=lake.days[k];if(want?!['yes','travel'].includes(cur):cur!=='no'){const presence=want?'yes':'no';await api('/hub/lake/days/'+k,{method:'PUT',body:{presence}});lake.days[k]=presence;}}
    const key=fridayOf(body.start_date),w=lake.weekends[key]||{},queen=suiteNames('queen'),bunks=suiteNames('bunks'),n9=form.elements.notes_9112.value.trim();
    if(editing||body.title||queen.length||bunks.length||n9){const {weekend}=await api('/hub/lake/weekends/'+key,{method:'PUT',body:{title:body.title||(editing?'':w.title||''),notes:w.notes||'',notes_9112:editing?n9:n9||w.notes_9112||'',queen:editing?queen:queen.length?queen:w.queen||[],bunks:editing?bunks:bunks.length?bunks:w.bunks||[]}});lake.weekends[key]=weekend;}}
   // A saved edit stays open read-only; a new booking clears the form.
   if(editing){viewing=reservation;editing=false;}else newBooking();
   await H.load();notice('booking-message',viewing?'Stay updated.':reservation.status==='pending'?'Request sent. Your dates are held pending approval.':'Stay confirmed.');}catch(e){notice('booking-message',e.message,true);if(e.status===409)await H.load();}finally{b.disabled=false;}
 });
 // Each tab strip only drives the panels in its own group: the lake strip above the calendar, the section strip below it.
 document.querySelectorAll('.tabbar').forEach(bar=>{const group=bar.dataset.group||'';bar.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{bar.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-pressed',t===b?'true':'false'));document.querySelectorAll('[data-panel]').forEach(p=>{if((p.dataset.group||'')===group)p.hidden=!p.dataset.panel.split(' ').includes(b.dataset.tab);});}));});
 $('add-maintenance').addEventListener('click',()=>H.openTask('maintenance'));
 $('property-form').addEventListener('input',()=>{propertyDirty=true;});
 $('property-form').addEventListener('submit',async event=>{
  event.preventDefault();const f=event.currentTarget,b=f.querySelector('[type=submit]');b.disabled=true;notice('property-message','Saving…');const body=Object.fromEntries(new FormData(f));
  for(const k of ['max_guests','max_nights'])body[k]=body[k]===''?null:Number(body[k]);body.advance_days=Number(body.advance_days);body.revision=propertyRevision;
  // Times are no longer edited on the page; the API still requires them, so the stored values pass through unchanged.
  body.check_in=state.property.check_in.slice(0,5);body.check_out=state.property.check_out.slice(0,5);
  try{await api('/hub/property',{method:'PATCH',body});propertyDirty=false;await H.load();notice('property-message','Property details saved.');}catch(e){notice('property-message',e.message,true);}finally{b.disabled=false;}
 });
 // ---- Lake schedule: only for the signed-in schedule owner (Chester) ----
 // Presence: a day marked on the calendar is at the lake (older travel values count too); away comes from dated ranges with a reason.
 // A confirmed 6108 stay assumes the owner is there unless he unchecks it; his own marks and away ranges come first.
 const LAKE_LABEL={yes:'at the lake',away:'away from the lake',no:'not at the lake'},LAKE_CLASS={yes:'here',away:'away'};
 const awayFor=key=>lake?.away?.find(a=>a.start_date<=key&&key<=a.end_date);
 const assumedThere=key=>!!lake&&occupied(key)?.status==='confirmed';
 const presenceOf=key=>{if(!lake)return;const p=lake.days[key];if(['yes','travel'].includes(p))return 'yes';if(p==='no')return 'no';if(awayFor(key))return 'away';if(assumedThere(key))return 'yes';};
 let lake=null,marking=false;
 const addDays=(d,n)=>{const x=date(d);x.setDate(x.getDate()+n);return iso(x);};
 const short=d=>date(d).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
 const weekendLabel=w=>short(w)+(lake.weekends[w]?.title?' · '+lake.weekends[w].title:'');
 const fridayOf=key=>{const x=date(key),dow=x.getDay();x.setDate(x.getDate()+(dow===6?-1:dow===0?-2:5-dow));return iso(x);};
 async function savePresence(key,there){
  const presence=there?'yes':assumedThere(key)?'no':null;
  await api('/hub/lake/days/'+key,{method:'PUT',body:{presence}});
  if(presence)lake.days[key]=presence;else delete lake.days[key];calendar();
 }
 const setPresence=key=>savePresence(key,presenceOf(key)!=='yes');
 // ---- A tapped stay fills the booking form read-only. Managers can Edit it there and Save; a free day starts a new booking. ----
 let viewing=null,editing=false,thereInitial=true;
 const same=r=>!!viewing&&(viewing.id?r.id===viewing.id:r.start_date===viewing.start_date&&r.end_date===viewing.end_date&&r.status===viewing.status);
 const canEdit=r=>!!state.user?.condo_manager&&['pending','confirmed'].includes(r.status)&&r.end_date>=todayKey();
 const HEADINGS={pending:'Requested stay',blocked:'Blocked dates',cancelled:'Cancelled stay',declined:'Declined request'};
 const instant=()=>!!(state.user?.instant_booking||state.user?.condo_manager);
 const nightsOf=(start,end)=>{const out=[];for(let k=start;k<end;k=addDays(k,1))out.push(k);return out;};
 const fillNames=(suite,names,edit)=>{const fs=form.querySelector(`[data-suite=${suite}]`),list=fs.querySelector('.names');list.replaceChildren(...names.map(n=>nameField(suite,n)));if(edit||!names.length)list.append(nameField(suite));fs.hidden=!edit&&!names.length;};
 function showStay(r,edit=false){
  viewing=r;editing=edit;selected=null;notice('booking-message','');
  const w=lake?lake.weekends[fridayOf(r.start_date)]||{}:{};
  form.elements.title.value=r.title||w.title||'';form.elements.start_date.value=r.start_date;form.elements.end_date.value=r.end_date;form.elements.note.value=r.note||'';
  for(const suite of Object.keys(SUITES))fillNames(suite,r.suites?.[suite]||[],edit);
  if(lake){for(const suite of Object.keys(LAKE_SUITES))fillNames(suite,w[suite]||[],edit);form.elements.notes_9112.value=w.notes_9112||'';
   thereInitial=nightsOf(r.start_date,r.end_date).some(k=>presenceOf(k)==='yes');form.elements.there.checked=thereInitial;}
  setMode();
 }
 function newBooking(){viewing=null;editing=false;selected=null;notice('booking-message','');form.reset();renderSuites();form.querySelectorAll('fieldset.suite').forEach(f=>{f.hidden=false;});setMode();}
 function setMode(){
  const view=!!viewing&&!editing;form.classList.toggle('viewing',view);
  form.querySelectorAll('input:not([type=checkbox]),textarea').forEach(i=>{i.readOnly=view;});form.querySelectorAll('.names input').forEach(i=>{i.placeholder=view?'':'Guest';});
  // Read-only views hide what is empty; dates and the presence box always show.
  form.querySelectorAll('label').forEach(l=>{const i=l.querySelector('input,textarea');if(i&&i.type!=='date'&&i.type!=='checkbox')l.hidden=view&&!i.value;});
  form.elements.there.disabled=view;
  $('form-title').textContent=viewing?HEADINGS[viewing.status]||'Booked stay':'Book a weekend:';
  stayActions(view);
  const b=$('edit-stay');b.hidden=!viewing||(!editing&&!canEdit(viewing));b.textContent=editing?'Cancel':'Edit';
  const s=$('book-submit');s.hidden=view;s.textContent=editing?'Save changes':instant()?'Book stay':'Request stay';
  updateSelection();
 }
 // Approve, decline and cancel live under the read-only stay, where the reservation list used to offer them.
 function stayActions(view){
  const acts=$('stay-actions');acts.replaceChildren();
  if(view&&state.user&&viewing.id){
   const r=viewing,add=(label,status,text)=>{const b=node('button',label,'quiet');b.type='button';b.addEventListener('click',()=>H.action(b,async()=>{await api('/hub/reservations/'+r.id,{method:'PATCH',body:{status,revision:r.revision}});await H.load();notice('booking-message',text);}));acts.append(b);};
   if(r.status==='pending'&&state.user.condo_manager){add('Approve','confirmed','Stay approved.');add('Decline','declined','Request declined. Dates are available again.');}
   if(['confirmed','pending','blocked'].includes(r.status)&&(state.user.condo_manager||r.user_id===state.user.id))add(r.status==='blocked'?'Unblock dates':'Cancel stay','cancelled',r.status==='blocked'?'Dates unblocked.':'Reservation cancelled. Dates are available again.');
  }
  acts.hidden=!acts.children.length;
 }
 $('edit-stay').addEventListener('click',()=>showStay(viewing,!editing));
 $('mark-days').addEventListener('click',()=>{
  marking=!marking;const b=$('mark-days');b.setAttribute('aria-pressed',String(marking));b.textContent=marking?'Done marking':'Mark my days';
  document.querySelector('.calendar').classList.toggle('marking',marking);notice('booking-message',marking?'Tap a day to mark it at the lake; tap again to clear. Away dates are added on the Away tab.':'');calendar();
 });
 async function patchInvite(inv,changes){const {invite}=await api('/hub/lake/invites/'+inv.id,{method:'PATCH',body:changes});Object.assign(inv,invite);invites();}
 function invites(){
  if(!lake)return;const list=$('invite-list');list.replaceChildren();
  if(!lake.invites.length)list.append(node('p','No one on the list yet.','empty'));
  const upcoming=[];{const x=new Date();x.setDate(x.getDate()+((5-x.getDay()+7)%7));for(let i=0;i<26;i++){upcoming.push(iso(x));x.setDate(x.getDate()+7);}}
  for(const inv of lake.invites){
   const card=node('article',undefined,'invite'),f=node('form');f.className='fields';
   const nameLabel=node('label','Name'),nameInput=node('input');nameInput.value=inv.name;nameInput.maxLength=80;nameInput.required=true;nameLabel.append(nameInput);
   const noteLabel=node('label','Note'),noteInput=node('input');noteInput.value=inv.note||'';noteInput.maxLength=400;noteInput.placeholder='Status or details';noteLabel.append(noteInput);
   f.append(nameLabel,noteLabel);f.addEventListener('submit',e=>{e.preventDefault();save.click();});card.append(f);
   const chips=node('div',undefined,'chips');
   for(const w of inv.weekends){const c=node('button',weekendLabel(w),'chip');c.type='button';c.setAttribute('aria-label','Remove '+short(w));c.addEventListener('click',()=>H.action(c,()=>patchInvite(inv,{weekends:inv.weekends.filter(k=>k!==w)})));chips.append(c);}
   const sel=node('select');sel.setAttribute('aria-label','Add an available weekend');sel.append(new Option('Add a weekend…',''));
   for(const w of upcoming.filter(k=>!inv.weekends.includes(k)))sel.append(new Option(weekendLabel(w),w));
   sel.addEventListener('change',()=>{const w=sel.value;if(w)H.action(sel,()=>patchInvite(inv,{weekends:[...inv.weekends,w].sort()}));});
   chips.append(sel);card.append(chips);
   const controls=node('div',undefined,'row'),save=node('button','Save','quiet'),remove=node('button','Remove','quiet');save.type='button';remove.type='button';save.hidden=true;
   f.addEventListener('input',()=>{save.hidden=false;});
   save.addEventListener('click',()=>H.action(save,()=>patchInvite(inv,{name:nameInput.value.trim(),note:noteInput.value.trim()})));
   remove.addEventListener('click',()=>{if(remove.dataset.confirm!=='yes'){remove.dataset.confirm='yes';remove.textContent='Remove from the list?';return;}H.action(remove,async()=>{await api('/hub/lake/invites/'+inv.id,{method:'DELETE'});lake.invites=lake.invites.filter(i=>i!==inv);invites();});});
   if(inv.group)controls.append(node('span','Group '+inv.group,'pill'));controls.append(save,remove);card.append(controls);list.append(card);
  }
 }
 // ---- Away: the calendar stays and the form column switches to away dates. Tap days for From and Through; tap an amber day to load its range. ----
 let awayMode=false,awaySel=null,awayOpen=null;const awayForm=$('away-form');
 function setAwayMode(on){awayMode=on;form.hidden=on;awayForm.hidden=!on;if(on)newAway();else calendar();}
 function newAway(){awayOpen=null;awaySel=null;awayForm.reset();awayForm.querySelectorAll('input').forEach(i=>{i.readOnly=false;});$('away-new').hidden=true;$('away-submit').hidden=false;$('away-remove').hidden=true;notice('away-message','');calendar();}
 function showAway(a){awayOpen=a;awaySel=null;awayForm.elements.start_date.value=a.start_date;awayForm.elements.end_date.value=a.end_date;awayForm.elements.reason.value=a.reason||'';awayForm.querySelectorAll('input').forEach(i=>{i.readOnly=true;});$('away-new').hidden=false;$('away-submit').hidden=true;$('away-remove').hidden=false;notice('away-message','');calendar();}
 document.querySelectorAll('#lake-tabs [data-tab]').forEach(b=>b.addEventListener('click',()=>setAwayMode(b.dataset.tab==='away')));
 $('away-new').addEventListener('click',newAway);
 $('away-remove').addEventListener('click',()=>{const a=awayOpen,b=$('away-remove');H.action(b,async()=>{await api('/hub/lake/away/'+a.id,{method:'DELETE'});lake.away=lake.away.filter(x=>x!==a);newAway();});});
 awayForm.addEventListener('submit',async e=>{
  e.preventDefault();const b=$('away-submit'),body=Object.fromEntries(new FormData(awayForm));
  if(!body.start_date||!body.end_date||body.end_date<body.start_date){notice('away-message','Choose a first and last day, in order.',true);return;}
  b.disabled=true;
  try{const {away}=await api('/hub/lake/away',{method:'POST',body});lake.away.push(away);newAway();notice('away-message','Added.');}catch(err){notice('away-message',err.message,true);}finally{b.disabled=false;}
 });
 $('invite-form').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget,b=f.querySelector('[type=submit]');b.disabled=true;
  try{const {invite}=await api('/hub/lake/invites',{method:'POST',body:Object.fromEntries(new FormData(f))});lake.invites.push(invite);f.reset();notice('invite-message','Added to the list.');invites();}catch(err){notice('invite-message',err.message,true);}finally{b.disabled=false;}
 });
 H.init(refresh,{anonymous:true});
})();
