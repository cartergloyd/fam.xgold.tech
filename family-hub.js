(() => {
 'use strict';
 const BASE='https://fam-api.xgold.tech/family';
 const $=id=>document.getElementById(id);
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const session=()=>{try{return JSON.parse(localStorage.getItem('family-session'));}catch{return null;}};
 const notice=(id,message,error=false)=>{const n=$(id);if(n){n.textContent=message;n.classList.toggle('error',error);}};
 let currentUser=null, refresh=()=>{},editing=null,kind,anonymous=false;
 const signedIn=()=>{const s=session();return !!s?.token&&s.name===window.familyAccount.current?.name;};
 // `anonymous` lets a public page call open endpoints without a session; signed-in calls still carry the token.
 async function api(path,{method='GET',body,anonymous:open=false}={}){
  const s=session(),signed=signedIn();
  if(!signed&&!open)throw Object.assign(Error('Sign in with your email and PIN to continue.'),{status:401});
  const r=await fetch(BASE+path,{method,credentials:'omit',cache:'no-store',headers:{Accept:'application/json',...(signed?{'X-Family-Session':s.token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  let data;try{data=await r.json();}catch{throw Error('The service is temporarily unavailable.');}
  if(!r.ok){if(r.status===401){localStorage.removeItem('family-session');auth(false);}throw Object.assign(Error(data.error||'Please try again.'),{status:r.status});}
  return data;
 }
 // Pages without a sign-in wall have no auth panel, so each of these ids is optional.
 function auth(ok){for(const [id,hide]of [['auth-panel',ok],['signed-content',!ok],['add-build',!ok]])if($(id))$(id).hidden=hide;}
 async function load(){
  let signed=false;
  try{
   try{await window.familyAccount.ready;}catch(e){if(!anonymous)throw e;}
   signed=signedIn();
   if(!signed){currentUser=null;auth(false);if(!anonymous)return;}
   await refresh(signed);if(signed)auth(true);notice('page-message','');
  }catch(e){
   if(e.status===401){currentUser=null;auth(false);
    // An expired session on a public page falls back to the visitor view.
    if(anonymous&&signed){try{await refresh(false);notice('page-message','');return;}catch(err){e=err;}}}
   notice('page-message',e.message,true);
  }
 }
 async function action(button,fn){button.disabled=true;try{await fn();}catch(e){notice('page-message',e.message,true);}finally{button.disabled=false;}}
 function openTask(type,task=null){
  editing=task;kind=type;const form=$('task-form');form.reset();
  $('task-dialog-title').textContent=task?'Edit card':type==='build'?'Add a build':'Report a maintenance issue';
  for(const k of ['title','description','status','world','x','y','z'])if(task?.[k]!==null&&task?.[k]!==undefined)form.elements[k].value=task[k];
  $('task-location').hidden=type!=='build';$('delete-task').hidden=!task;notice('task-message','');$('task-dialog').showModal();
 }
 function board(id,tasks,type,user){
  const target=$(id);target.replaceChildren();
  for(const [status,title]of [['todo','To do'],['doing','In progress'],['done','Done']]){
   const column=node('section',undefined,'column');column.append(node('h3',title+' · '+tasks.filter(t=>t.status===status).length));
   const cards=tasks.filter(t=>t.status===status);
   if(!cards.length)column.append(node('p',status!=='todo'?'Nothing here yet.':type==='maintenance'?'No open issues.':'Room for your next idea.','empty'));
   for(const task of cards){
    const card=node('article',undefined,'card');card.append(node('h4',task.title));if(task.description)card.append(node('p',task.description));
    card.append(node('p',type==='maintenance'?'Reported by '+task.name:'Added by '+task.name,'caption'));
    if(type==='build'&&task.x!==null){const coords=node('a',`${({world:'Overworld',world_nether:'Nether',world_the_end:'The End'})[task.world]} · ${task.x}, ${task.y}, ${task.z}`);coords.href=BASE+'/mc-map/?'+new URLSearchParams({worldname:task.world,mapname:task.world==='world'?'surface':'flat',x:task.x,y:task.y,z:task.z,zoom:5});coords.target='_blank';coords.rel='noopener';card.append(coords);}
    if(type==='build'||user.maintenance_manager||user.condo_manager){
     const controls=node('div',undefined,'row');const edit=node('button','Edit','quiet');edit.type='button';edit.addEventListener('click',()=>openTask(type,task));controls.append(edit);
     if(status!=='done'){const next=node('button',status==='todo'?'Start':'Complete','quiet');next.type='button';next.addEventListener('click',()=>action(next,async()=>{await api('/hub/tasks/'+task.id,{method:'PATCH',body:{...task,status:status==='todo'?'doing':'done'}});await load();}));controls.append(next);}card.append(controls);
    }column.append(card);
   }target.append(column);
  }
 }
 document.querySelectorAll('[data-signin]').forEach(b=>b.addEventListener('click',()=>window.familyAccount.show()));
 $('close-task').addEventListener('click',()=>$('task-dialog').close());
 $('task-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;notice('task-message','Saving…');
  const b=Object.fromEntries(new FormData(form));for(const k of ['x','y','z'])b[k]=b[k]===''?null:Number(b[k]);b.kind=kind;if(editing)b.revision=editing.revision;
  try{await api('/hub/tasks'+(editing?'/'+editing.id:''),{method:editing?'PATCH':'POST',body:b});$('task-dialog').close();await load();}catch(e){notice('task-message',e.message,true);}finally{button.disabled=false;}
 });
 $('delete-task').addEventListener('click',async event=>{
  if(!editing)return;const button=event.currentTarget;
  if(button.dataset.confirm!=='yes'){button.dataset.confirm='yes';button.textContent='Delete this card permanently?';return;}
  button.disabled=true;
  try{await api('/hub/tasks/'+editing.id,{method:'DELETE',body:{revision:editing.revision}});$('task-dialog').close();await load();}catch(e){notice('task-message',e.message,true);}finally{button.disabled=false;}
 });
 $('task-dialog').addEventListener('close',()=>{delete $('delete-task').dataset.confirm;$('delete-task').textContent='Delete card';});
 window.addEventListener('family-account-change',load);
 window.addEventListener('storage',e=>{if(e.key==='family-session')load();});
 window.familyHub={api,$,node,notice,board,openTask,load,action,signedIn,get user(){return currentUser;},set user(u){currentUser=u;},init(fn,options={}){refresh=fn;anonymous=!!options.anonymous;load();}};
 setInterval(()=>{if(!document.hidden&&!$('task-dialog').open)load();},60000);
})();
