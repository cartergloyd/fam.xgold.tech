// A just-big-enough stand-in for the knex calls lake.js makes, so this runs without PostgreSQL. Constraints (Friday check,
// jsonb, lengths) are checked by lake.js itself; the SQL side is exercised by the real-database run described in the README.
const KEYS={family_lake_days:['user_id','day'],family_lake_weekends:['user_id','friday'],family_lake_calendar:['user_id']};
const JSON_COLUMNS=['queen','bunks','weekends'];
export function fakeDatabase(tables){
 let serial=0;const inc={__increment:true};
 const parse=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,JSON_COLUMNS.includes(k)&&typeof v==='string'?JSON.parse(v):v]));
 const db=table=>{
  const filters=[];let order=null,insert=null,conflict=null,merge=undefined,changes=null,remove=false,aggregate=null;
  const rows=()=>{let r=tables[table].filter(row=>filters.every(f=>f(row)));if(order)r=[...r].sort((a,b)=>a[order]>b[order]?1:-1);return r;};
  const run=()=>{
   if(Array.isArray(insert)){const made=insert.map(r=>db(table).insert(r).run());return made.flat();}
   if(insert){
    const keys=conflict||KEYS[table]||['id'],hit=conflict&&tables[table].find(r=>keys.every(k=>r[k]===insert[k]));
    if(hit){Object.assign(hit,parse(merge===undefined?insert:Object.fromEntries(Object.entries(merge).map(([k,v])=>[k,v===inc?hit[k]+1:v]))));return [hit];}
    const row=parse({id:`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`,revision:1,title:'',notes:'',notes_9112:'',queen:[],bunks:[],note:'',reason:'',weekends:[],group_no:null,...insert});tables[table].push(row);return [row];
   }
   if(changes){const hit=rows();hit.forEach(r=>Object.assign(r,parse(changes)));return hit;}
   if(remove){const gone=rows();tables[table]=tables[table].filter(r=>!gone.includes(r));return gone.length;}
   return rows();
  };
  const q={
   where(c,op,v){filters.push(typeof c==='object'?r=>Object.entries(c).every(([k,x])=>r[k]===x):op==='>='?r=>r[c]>=v:r=>r[c]<=v);return q;},
   orderBy(k){order=k;return q;},select(){return q;},
   first:async()=>aggregate?{[aggregate.as]:aggregate.fn(rows())}:rows()[0],
   count(spec){aggregate={as:spec.split(' as ')[1],fn:r=>r.length};return q;},
   max(spec){const [col,as]=spec.split(' as ');aggregate={as,fn:r=>r.length?Math.max(...r.map(x=>x[col])):null};return q;},
   insert(row){insert=row;return q;},onConflict(cols){conflict=[].concat(cols);return q;},merge(obj){merge=obj;return q;},
   update(c){changes=c;return q;},del(){remove=true;return q;},returning(){return q;},
   run,
   then(resolve,reject){return Promise.resolve().then(run).then(resolve,reject);},
  };
  return q;
 };
 db.raw=()=>inc;
 db.transaction=async fn=>fn(db);
 return db;
}
