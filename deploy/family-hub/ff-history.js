import {sessionUser} from './hub-session.js';
// The fantasy league's all-time record and yearly awards. One private jsonb document, readable only with a signed-in family session.
export default function ffHistory(router,{database},options={}){
 router.get('/hub/ff-history',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const user=await sessionUser(database,req.get('X-Family-Session')||'',options.secret||process.env.SECRET);
   if(!user)return res.status(401).json({error:'Sign in with your family email and PIN to continue.'});
   const row=await database('family_ff_history').where({id:'league'}).first('doc');
   res.json({history:row?row.doc:null});
  }catch{res.status(503).json({error:'The record book is temporarily unavailable. Please try again.'});}
 });
}
