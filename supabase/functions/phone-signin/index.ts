// Password authentication is performed by Supabase Auth before any session is returned.
const origins=new Set(['https://nlagmediahub.xyz','https://service-team-roster.riyazshaik2510.chatgpt.site']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const started=Date.now();
 const failure=async()=>{await new Promise(r=>setTimeout(r,Math.max(0,600-(Date.now()-started))));return reply({error:'Unable to sign in. Check your phone number and password, or use your email.'},401);};
 try{
  if(Number(req.headers.get('content-length')||0)>4096)return reply({error:'Request too large'},413);
  const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);
  const {phone,password}=JSON.parse(raw);
  if(typeof phone!=='string'||typeof password!=='string'||phone.length>30||!password||password.length>1024||!/^\+?[\d\s().-]{8,30}$/.test(phone))return await failure();
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const resolved=await fetch(url+'/rest/v1/rpc/resolve_phone_signin',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_phone:phone})});
  if(!resolved.ok)return reply({error:'Sign-in is temporarily unavailable. Please use email or try again.'},503);
  const lookup=await resolved.json();if(!lookup.allowed)return reply({error:'Too many sign-in attempts. Use email or try again in 15 minutes.'},429);
  const response=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email:lookup.email||'unregistered-phone-signin@invalid.example',password})});
  const session=await response.json();
  if(!lookup.email||!response.ok||!session.access_token||!session.refresh_token)return await failure();
  return reply({access_token:session.access_token,refresh_token:session.refresh_token});
 }catch{return reply({error:'Sign-in is temporarily unavailable. Please try again.'},503);}
});
