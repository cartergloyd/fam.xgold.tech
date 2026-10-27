// Public, read-only trip details for the family home page. No sessions, no writes,
// and only the trip, property and room fields the page renders.
const ID=/^[a-z0-9][a-z0-9-]{0,39}$/;
const day=d=>typeof d==='string'?d.slice(0,10):d.toISOString().slice(0,10);
export function today(timezone){
 try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'America/Chicago'}).format(new Date());}
 catch{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());}
}
// The trip in progress or the next to start; after the last trip ends it stays featured.
export function pickTrip(trips,now=today){
 const open=trips.filter(t=>day(t.end_date)>=now(t.timezone)).sort((a,b)=>day(a.start_date)<day(b.start_date)?-1:1);
 if(open.length)return open[0];
 return trips.slice().sort((a,b)=>day(a.end_date)<day(b.end_date)?1:-1)[0]||null;
}
export const publicTrip=(t,driver)=>({id:t.id,property_id:t.property_id,title:t.title,start_date:day(t.start_date),end_date:day(t.end_date),
 origin_airport:t.origin_airport||null,local_airports:Array.isArray(t.local_airports)?t.local_airports:[],driver:driver||null,tagline:t.tagline||'',countdown:t.countdown||'the trip'});
export const publicProperty=p=>({id:p.id,title:p.title,kind:p.kind||'family',description:p.description||'',house_rules:p.house_rules||'',
 check_in:String(p.check_in).slice(0,5),check_out:String(p.check_out).slice(0,5),timezone:p.timezone,address:p.address||'',
 bedrooms:p.bedrooms??null,bathrooms:p.bathrooms??null,sleeps:p.sleeps??null,
 spaces:p.spaces||[],amenities:p.amenities||[],nearby:p.nearby||[],hero:p.hero||[],gallery:p.gallery||[],cards:p.cards||{}});
export default function familyTrips(router,{database}){
 router.get('/trip',async(req,res)=>{
  res.set('Cache-Control','public, max-age=60');
  try{
   const wanted=typeof req.query.id==='string'&&ID.test(req.query.id)?req.query.id:null;
   const trips=await database('family_trips as t').join('family_properties as p','t.property_id','p.id').select('t.*','p.timezone').orderBy('t.start_date');
   const trip=wanted?trips.find(t=>t.id===wanted):pickTrip(trips);
   if(!trip)return res.status(404).json({error:wanted?'That trip was not found.':'No trip is planned yet.'});
   const [property,rooms,driver]=await Promise.all([
    database('family_properties').where({id:trip.property_id}).first(),
    database('family_rooms').where({property_id:trip.property_id}).orderBy('sort').orderBy('slug'),
    trip.driver_id?database('family_users').where({id:trip.driver_id}).first('name'):null]);
   res.json({trip:publicTrip(trip,driver?.name),property:publicProperty(property),
    rooms:rooms.map(r=>({id:r.slug,name:r.name,photos:Array.isArray(r.photos)?r.photos:[]})),
    trips:trips.map(t=>({id:t.id,title:t.title,start_date:day(t.start_date),end_date:day(t.end_date)}))});
  }catch{res.status(503).json({error:'Trip details are temporarily unavailable. Please try again.'});}
 });
}
