(() => {
 const H=window.familyHub,{$,api,node,notice}=H;
 const form=$('booking-form');let state,month=new Date(),selected=null,propertyDirty=false,propertyRevision;
 month=new Date(month.getFullYear(),month.getMonth(),1);
 const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const date=d=>new Date(d+'T12:00:00');
 const fmt=d=>date(d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
 const occupied=d=>state.reservations.find(r=>['pending','confirmed','blocked'].includes(r.status)&&r.start_date<=d&&r.end_date>d);
 function calendar(){
  $('calendar-title').textContent=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const body=$('calendar-days');body.replaceChildren();const first=month.getDay(),days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:state.property.timezone}).format(new Date());
  let row;
  for(let i=0;i<Math.ceil((first+days)/7)*7;i++){
   if(i%7===0){row=node('tr');body.append(row);}const cell=node('td');row.append(cell);const day=i-first+1;if(day<1||day>days)continue;
   const d=new Date(month.getFullYear(),month.getMonth(),day),key=iso(d),r=occupied(key),button=node('button',String(day));button.type='button';
   button.disabled=key<today;button.classList.toggle('busy',!!r);button.classList.toggle('selected',key===form.elements.start_date.value||key===form.elements.end_date.value||(key>form.elements.start_date.value&&key<form.elements.end_date.value));
   button.setAttribute('aria-pressed',button.classList.contains('selected')?'true':'false');
   button.setAttribute('aria-label',d.toLocaleDateString(undefined,{dateStyle:'full'})+(r?`, ${r.status==='blocked'?'unavailable':r.status+' stay'}`:', available'));
   if(r)button.append(node('small',r.status==='pending'?'Requested':r.status==='blocked'?'Blocked':'Booked'));
   button.addEventListener('click',()=>{
    // A held start date can be selected as checkout for an adjacent stay.
    if(r&&(!selected||key<=selected)){notice('booking-message','This night is already held. It can still be a check-out date for an earlier stay.');return;}
    if(!selected||key<=selected){selected=key;form.elements.start_date.value=key;form.elements.end_date.value='';}
    else{form.elements.end_date.value=key;selected=null;}updateSelection();
   });cell.append(button);
  }
 }
 function updateSelection(){
  const start=form.elements.start_date.value,end=form.elements.end_date.value,days=(Date.parse(end)-Date.parse(start))/86400000;
  form.elements.end_date.min=start||form.elements.start_date.min;
  let message=days>0?`${days} night${days===1?'':'s'} · Check-in ${state.property.check_in.slice(0,5)} · Check-out ${state.property.check_out.slice(0,5)} (${state.property.timezone})`:'Choose check-in and check-out dates.';
  const conflict=state.reservations.some(r=>['pending','confirmed','blocked'].includes(r.status)&&start<r.end_date&&end>r.start_date);
  if(conflict&&days>0)message='Your selected stay overlaps held dates. Choose another range.';
  $('stay-summary').textContent=message;calendar();
 }
 async function loadAccess(){
  const {users}=await api('/hub/booking-access');const list=$('booking-access');list.replaceChildren();
  for(const u of users){const label=node('label',undefined,'check');label.append(node('span',u.name+(u.condo_manager?' · Manager':'')));const input=node('input');input.type='checkbox';input.checked=u.instant_booking;input.disabled=u.condo_manager;
   input.addEventListener('change',async()=>{const value=input.checked;input.disabled=true;try{await api('/hub/booking-access/'+u.id,{method:'PATCH',body:{instant_booking:value}});notice('page-message','Booking access updated for '+u.name+'.');}catch(e){input.checked=!value;notice('page-message',e.message,true);}finally{input.disabled=false;}});label.append(input);list.append(label);}
 }
 function reservations(){
  const list=$('reservation-list');list.replaceChildren();const upcoming=state.reservations.filter(r=>r.end_date>=new Intl.DateTimeFormat('en-CA',{timeZone:state.property.timezone}).format(new Date()));
  if(!upcoming.length)list.append(node('p','The calendar is open. Choose dates for the next family visit.','empty'));
  for(const r of upcoming){const card=node('article',undefined,'reservation');card.append(node('h3',fmt(r.start_date)+' – '+fmt(r.end_date)));card.append(node('span',r.status==='pending'?'Awaiting Carter or Chester':r.status[0].toUpperCase()+r.status.slice(1),'pill'));card.append(node('p',r.status==='blocked'?'Property unavailable':`${r.name} · ${r.guests} guest${r.guests===1?'':'s'}`));if(r.note)card.append(node('p',r.note,'muted'));
   const controls=node('div',undefined,'row');
   const add=(label,status)=>{const b=node('button',label,'quiet');b.type='button';b.addEventListener('click',()=>H.action(b,async()=>{await api('/hub/reservations/'+r.id,{method:'PATCH',body:{status,revision:r.revision}});await H.load();notice('page-message',status==='confirmed'?'Stay approved.':status==='declined'?'Request declined. Dates are available again.':'Reservation cancelled. Dates are available again.');}));controls.append(b);};
   if(r.status==='pending'&&state.user.condo_manager){add('Approve','confirmed');add('Decline','declined');}
   if(['confirmed','pending','blocked'].includes(r.status)&&(state.user.condo_manager||r.user_id===state.user.id))add(r.status==='blocked'?'Unblock dates':'Cancel stay','cancelled');
   if(controls.children.length)card.append(controls);list.append(card);
  }
 }
 async function refresh(){
  state=await api('/hub/condo');H.user=state.user;
  $('property-title').textContent=state.property.title;$('block-option').hidden=!state.user.condo_manager;$('manage-tab').hidden=!state.user.condo_manager;
  if(!state.user.condo_manager&&document.querySelector('[data-panel=manage]').hidden===false)document.querySelector('[data-tab=stays]').click();
  const instant=state.user.instant_booking||state.user.condo_manager;
  $('booking-policy').textContent=instant?'You can book available dates instantly.':'Carter or Chester will approve your request. Your dates are held while it’s pending.';
  $('book-submit').textContent=form.elements.blocked.checked?'Block dates':instant?'Book stay':'Request stay';
  form.elements.start_date.min=new Intl.DateTimeFormat('en-CA',{timeZone:state.property.timezone}).format(new Date());form.elements.guests.max=state.property.max_guests||100;
  $('property-description').textContent=state.property.description||'Carter and Chester will add property details here.';
  $('property-rules').textContent=state.property.house_rules||'House rules will be added here.';
  $('property-times').textContent=`Check-in ${state.property.check_in.slice(0,5)} · Check-out ${state.property.check_out.slice(0,5)} (${state.property.timezone})`;
  if(state.user.condo_manager){if(!propertyDirty){propertyRevision=state.property.revision;for(const k of ['title','description','house_rules','check_in','check_out','max_guests','max_nights','advance_days','timezone'])$('property-form').elements[k].value=(k==='check_in'||k==='check_out')?state.property[k].slice(0,5):state.property[k]??'';}await loadAccess();}
  updateSelection();reservations();H.board('maintenance-board',state.tasks,'maintenance',state.user);
 }
 $('prev-month').addEventListener('click',()=>{month.setMonth(month.getMonth()-1);calendar();});$('next-month').addEventListener('click',()=>{month.setMonth(month.getMonth()+1);calendar();});
 for(const k of ['start_date','end_date'])form.elements[k].addEventListener('change',()=>{selected=null;updateSelection();});
 form.elements.blocked.addEventListener('change',()=>{$('book-submit').textContent=form.elements.blocked.checked?'Block dates':state.user.instant_booking||state.user.condo_manager?'Book stay':'Request stay';});
 form.addEventListener('submit',async event=>{
  event.preventDefault();const b=$('book-submit');b.disabled=true;notice('booking-message','Saving your dates…');
  const body={start_date:form.elements.start_date.value,end_date:form.elements.end_date.value,guests:Number(form.elements.guests.value),note:form.elements.note.value,status:form.elements.blocked.checked?'blocked':undefined};
  try{const {reservation}=await api('/hub/reservations',{method:'POST',body});form.reset();selected=null;await H.load();notice('booking-message',reservation.status==='pending'?'Request sent. Your dates are held for Carter or Chester to review.':reservation.status==='blocked'?'Dates blocked.':'Your stay is confirmed.');}catch(e){notice('booking-message',e.message,true);if(e.status===409)await H.load();}finally{b.disabled=false;}
 });
 document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-pressed',t===b?'true':'false'));document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==b.dataset.tab);}));
 $('add-maintenance').addEventListener('click',()=>H.openTask('maintenance'));
 $('property-form').addEventListener('input',()=>{propertyDirty=true;});
 $('property-form').addEventListener('submit',async event=>{
  event.preventDefault();const f=event.currentTarget,b=f.querySelector('[type=submit]');b.disabled=true;notice('property-message','Saving…');const body=Object.fromEntries(new FormData(f));
  for(const k of ['max_guests','max_nights'])body[k]=body[k]===''?null:Number(body[k]);body.advance_days=Number(body.advance_days);body.revision=propertyRevision;
  try{await api('/hub/property',{method:'PATCH',body});propertyDirty=false;await H.load();notice('property-message','Property details saved.');}catch(e){notice('property-message',e.message,true);}finally{b.disabled=false;}
 });
 H.init(refresh);
})();
