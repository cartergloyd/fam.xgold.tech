(() => {
  const query=document.getElementById('request-query');
  const form=document.getElementById('title-search');
  const results=document.getElementById('request-results');
  const status=document.getElementById('request-status');
  const api='https://fam-api.xgold.tech/family';
  let timer, controller, generation=0;
  let client, requested=new Set();
  try { client=localStorage.getItem('streaming-request-client'); requested=new Set(JSON.parse(localStorage.getItem('streaming-requested') || '[]')); } catch {}
  if (!/^[0-9a-f-]{36}$/i.test(client || '')) client=crypto.randomUUID();
  try { localStorage.setItem('streaming-request-client',client); } catch {}
  const identity=() => window.familyAccount?.current?.name || 'Guest';
  const key=item => identity()+':'+item.type+':'+item.id;
  const buttonState=(button,item) => {
    const done=requested.has(key(item)); button.disabled=done; button.textContent=done?'Requested':'Request';
    button.setAttribute('aria-label', (done?'Requested ':'Request ')+item.title+(item.year?' ('+item.year+')':'')+(item.type==='tv'?' TV show':' movie'));
  };
  const send=async (button,item) => {
    const requestKey=key(item), name=identity();
    button.disabled=true; button.textContent='Saving…'; status.textContent='';
    try {
      const response=await fetch(api+'/streaming-requests',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({selection:item.selection,client_id:client,requested_by:name})});
      const data=await response.json();
      if (!response.ok || !data.requested) throw Error(data.error || 'Your request could not be saved. Please try again.');
      requested.add(requestKey);
      try { localStorage.setItem('streaming-requested',JSON.stringify([...requested].slice(-300))); } catch {}
      buttonState(button,item); status.textContent='Requested “'+item.title+'”.';
    } catch (error) { buttonState(button,item); status.textContent=error.name==='TimeoutError'?'Your request took too long. Please try again.':error.message; }
  };
  let shown=[];
  const render=items => {
    results.replaceChildren(); shown=[];
    for(const item of items) {
      const row=document.createElement('article');row.className='request-result';
      const poster=document.createElement(item.poster?'img':'span');
      if(item.poster) {poster.src=item.poster;poster.alt='';poster.loading='lazy';poster.addEventListener('error',()=>{poster.removeAttribute('src');poster.className='request-poster';},{once:true});}
      else poster.className='request-poster';
      const info=document.createElement('div');info.className='request-info';
      const title=document.createElement('h3');title.className='request-name';title.textContent=item.title;
      const meta=document.createElement('p');meta.className='request-meta';meta.textContent=(item.type==='tv'?'TV show':'Movie')+(item.year?' · '+item.year:'');
      info.append(title,meta);
      const button=document.createElement('button');button.type='button';button.className='request-action';buttonState(button,item);button.addEventListener('click',()=>send(button,item));
      row.append(poster,info,button);results.append(row);shown.push({button,item});
    }
  };
  const search=async () => {
    clearTimeout(timer);controller?.abort(); const current=++generation;
    const q=query.value.trim();results.replaceChildren();shown=[];
    if(q.length<2) {status.textContent=q?'Keep typing to find a title.':'';results.removeAttribute('aria-busy');return;}
    const active=new AbortController();controller=active;const timeout=setTimeout(()=>active.abort(),15000);
    status.textContent='Searching…';results.setAttribute('aria-busy','true');
    try {
      const response=await fetch(api+'/streaming-search?q='+encodeURIComponent(q),{credentials:'omit',signal:active.signal});
      const data=await response.json();if(current!==generation)return;
      if(!response.ok)throw Error(data.error || 'Title search is temporarily unavailable. Please try again.');
      render(data.results || []);
      if (data.results?.length && document.activeElement===query && form.getBoundingClientRect().top > innerHeight*.45) form.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      status.textContent=data.results?.length?'Choose a title to request it.':'No titles found. Try another name.';
    }catch(error){if(current===generation)status.textContent=error.name==='AbortError'?'Search took too long. Please try again.':error.message;}
    finally{clearTimeout(timeout);if(current===generation)results.removeAttribute('aria-busy');}
  };
  query.addEventListener('input',()=>{clearTimeout(timer);controller?.abort();generation++;results.replaceChildren();shown=[];status.textContent='';results.removeAttribute('aria-busy');timer=setTimeout(search,400);});
  form.addEventListener('submit',event=>{event.preventDefault();search();});
  window.addEventListener('family-account-change',()=>{for(const {button,item} of shown)buttonState(button,item);});
})();
