import {sessionUser} from './hub-session.js';
const ACTIVE=['pending','processing','added'];
export function normalizeAccount(edition,value){
 if(!['java','bedrock'].includes(edition)||typeof value!=='string')return null;
 const name=value.trim();
 return (edition==='java'?/^[A-Za-z0-9_]{3,16}$/:/^[A-Za-z0-9][A-Za-z0-9 _]{0,15}$/).test(name)?name:null;
}
// The family_users row is what the whitelist worker syncs to the server. A username set there without a
// request on file (Carter linking someone in Directus) still shows on the page, as pending until its UUID exists.
export function accountsFor(user,requests){
 const accounts=[...requests];
 for(const edition of ['bedrock','java']){
  const username=user['mc_'+edition+'_username'];
  if(username&&!accounts.some(a=>a.edition===edition&&ACTIVE.includes(a.status)))accounts.unshift({id:null,edition,username,status:user['mc_'+edition+'_uuid']?'added':'pending',error:null});
 }
 return accounts;
}
export default function whitelist(router,{database},options={}){
 const run=fn=>async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   if(req.method!=='GET'&&req.get('Origin')!=='https://fam.xgold.tech')return res.status(403).json({error:'Please use the family website.'});
   const user=await sessionUser(database,req.get('X-Family-Session')||'',options.secret||process.env.SECRET);
   if(!user)return res.status(401).json({error:'Sign in with your family email and PIN to add your account.'});
   await fn(req,res,user);
  }catch(e){res.status(e.code==='23505'?409:503).json({error:e.code==='23505'?'This edition already has an account linked to your profile. Refresh to see its status.':'The whitelist service is temporarily unavailable. Please try again.'});}
 };
 router.get('/hub/mc-whitelist',run(async(_req,res,u)=>{
  const requests=await database('family_mc_whitelist').where({user_id:u.id}).select('id','edition','username','status','error').orderBy('date_created','desc').limit(20);
  res.json({accounts:accountsFor(u,requests)});
 }));
 router.post('/hub/mc-whitelist',run(async(req,res,u)=>{
  const edition=req.body?.edition,username=normalizeAccount(edition,req.body?.username);
  if(!username)return res.status(400).json({error:edition==='bedrock'?'Enter your Xbox gamertag (up to 16 letters, numbers, spaces or underscores; no dot prefix).':'Enter a Java username: 3–16 letters, numbers or underscores.'});
  const result=await database.transaction(async trx=>{
   // Serialize account linking and attempt limits for this family profile.
   const row=await trx('family_users').where({id:u.id}).forUpdate().first();
   const existing=await trx('family_mc_whitelist').where({user_id:u.id,edition}).whereIn('status',ACTIVE).first();
   if(existing)return {existing};
   // An account already verified on the directory row counts as this edition's link, request or not.
   if(row['mc_'+edition+'_uuid'])return {existing:{username:row['mc_'+edition+'_username'],status:'added'}};
   const {count}=await trx('family_mc_whitelist').where({user_id:u.id}).where('date_created','>',new Date(Date.now()-86400000)).count('* as count').first();
   if(Number(count)>=6)return {limited:true};
   const [account]=await trx('family_mc_whitelist').insert({user_id:u.id,edition,username}).returning(['id','edition','username','status']);
   // Store the self-reported name on the member's row now; the worker adds the UUID once the account is verified.
   await trx('family_users').where({id:u.id}).update({['mc_'+edition+'_username']:username});
   return {account};
  });
  if(result.limited)return res.status(429).json({error:'Too many account attempts today. Try again tomorrow or ask Carter for help.'});
  if(result.existing){if(result.existing.username.toLowerCase()!==username.toLowerCase())return res.status(409).json({error:'You already linked an account for this edition. Ask Carter if it needs changing.'});return res.json({account:{edition,username:result.existing.username,status:result.existing.status}});}
  res.status(202).json({account:result.account});
 }));
}
