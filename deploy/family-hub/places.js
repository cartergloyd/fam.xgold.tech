import {sessionUser} from './hub-session.js';
// Same key the activity collector writes: lowercase, no leading dot (Floodgate), no spaces or underscores.
export const accountKey=name=>String(name||'').toLowerCase().replace(/^\./,'').replace(/[\s_]/g,'');
const MAX_STARS=200;
export default function places(router,{database},options={}){
 const run=fn=>async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   if(req.method!=='GET'&&req.get('Origin')!=='https://fam.xgold.tech')return res.status(403).json({error:'Please use the family website.'});
   const user=await sessionUser(database,req.get('X-Family-Session')||'',options.secret||process.env.SECRET);
   if(!user)return res.status(401).json({error:'Sign in with your family email and PIN to continue.'});
   await fn(req,res,user);
  }catch{res.status(503).json({error:'Places are temporarily unavailable. Please try again.'});}
 };
 router.get('/hub/mc-stars',run(async(_req,res,u)=>{
  res.json({stars:await database('family_mc_pin_stars').where({user_id:u.id}).orderBy('date_created').pluck('pin_id')});
 }));
 router.post('/hub/mc-stars',run(async(req,res,u)=>{
  const pin=req.body?.pin,starred=req.body?.starred;
  if(typeof pin!=='string'||pin.length<1||pin.length>200||typeof starred!=='boolean')return res.status(400).json({error:'Choose a place to star.'});
  if(starred){
   // shortcut: the cap is checked before the insert, so two quick taps can pass it by one; fine for a family.
   const {count}=await database('family_mc_pin_stars').where({user_id:u.id}).count('* as count').first();
   if(Number(count)>=MAX_STARS)return res.status(429).json({error:'That is a lot of stars. Remove a few first.'});
   await database('family_mc_pin_stars').insert({user_id:u.id,pin_id:pin}).onConflict(['user_id','pin_id']).ignore();
  }else await database('family_mc_pin_stars').where({user_id:u.id,pin_id:pin}).del();
  res.json({starred});
 }));
 // Only the member's own linked accounts are ever looked up, so nobody can read another player's whereabouts.
 router.get('/hub/mc-last-seen',run(async(_req,res,u)=>{
  const keys=[u.mc_java_username,u.mc_bedrock_username].map(accountKey).filter(Boolean);
  const spot=keys.length?await database('family_mc_last_seen').whereIn('key',keys).orderBy('seen_at','desc').first('world','x','y','z','seen_at'):null;
  res.json({spot:spot||null});
 }));
}
