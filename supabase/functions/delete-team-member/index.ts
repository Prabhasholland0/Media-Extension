const origins=new Set(['https://nlagmediahub.xyz','https://service-team-roster.riyazshaik2510.chatgpt.site']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';const headers={'Content-Type':'application/json','Cache-Control':'no-store',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'Forbidden'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,authorization=req.headers.get('authorization')||'';
 const caller={apikey:anon,Authorization:authorization,'Content-Type':'application/json'},server={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 try{
 const userResponse=await fetch(url+'/auth/v1/user',{headers:caller});if(!userResponse.ok)return reply({error:'Sign in required'},401);const user=await userResponse.json();
 const adminResponse=await fetch(url+'/rest/v1/profiles?id=eq.'+user.id+'&select=is_admin,active',{headers:caller});const admins=await adminResponse.json();if(!adminResponse.ok||!admins[0]?.is_admin||!admins[0]?.active)return reply({error:'Admin access required'},403);
 const {user_id}=await req.json();if(typeof user_id!=='string'||! /^[0-9a-f-]{36}$/i.test(user_id)||user_id===user.id)return reply({error:'Invalid member'},400);
 const targetResponse=await fetch(url+'/rest/v1/profiles?id=eq.'+user_id+'&select=is_admin',{headers:caller});const targets=await targetResponse.json();if(!targetResponse.ok||!targets[0]||targets[0].is_admin)return reply({error:'This account cannot be removed'},403);
 for(let batch=0;batch<20;batch++){
 const list=await fetch(url+'/storage/v1/object/list/avatars',{method:'POST',headers:server,body:JSON.stringify({prefix:user_id+'/',limit:100,offset:0})});if(!list.ok)throw Error('Photo cleanup failed; member was not removed');const files=await list.json();if(!files.length)break;
 const removed=await fetch(url+'/storage/v1/object/avatars',{method:'DELETE',headers:server,body:JSON.stringify({prefixes:files.map((f:{name:string})=>user_id+'/'+f.name)})});if(!removed.ok)throw Error('Photo cleanup failed; member was not removed');if(batch===19)throw Error('More photos remain. Please retry removal');
 }
 const result=await fetch(url+'/rest/v1/rpc/permanently_delete_member',{method:'POST',headers:caller,body:JSON.stringify({p_user:user_id})});if(!result.ok)throw Error('Member could not be removed. Please refresh and retry.');return reply({success:true});
 }catch(e){return reply({error:e instanceof Error?e.message:'Removal failed'},400);}
});
