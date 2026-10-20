import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
export const configured=Boolean(SUPABASE_URL&&SUPABASE_PUBLISHABLE_KEY);
export let db;
export async function connect(){if(!configured)return null;const {createClient}=await import('./vendor/supabase.js');db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{global:{fetch:(url,options={})=>fetch(url,{...options,...(String(url).includes('/rest/v1/rpc/')?{keepalive:true}:{})})}});return db;}
export async function rpc(name,args){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
export async function signInWithIdentifier(identifier,password){
 if(identifier.includes('@'))return db.auth.signInWithPassword({email:identifier,password});
 const response=await fetch(`${SUPABASE_URL}/functions/v1/phone-signin`,{method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({phone:identifier,password})});
 const body=await response.json();
 if(!response.ok)throw Error(body.error||'Unable to sign in. Check your phone number and password.');
 return db.auth.setSession({access_token:body.access_token,refresh_token:body.refresh_token});
}
export async function loadDay(date){
 const [p,a,s]=await Promise.all([
  db.from('profiles').select('id,full_name,email,phone,avatar_url,skills,active,is_admin').order('full_name'),
  db.from('availability').select('user_id,service_date,service_id,status,submitted_at').eq('service_date',date),
  db.from('schedules').select('id,service_date,service_id,camera_count,not_needed_cameras,status,revision,updated_at,updated_by,assignments(position,user_id)').eq('service_date',date)
 ]);
 for(const result of [p,a,s])if(result.error)throw result.error;
 return {members:p.data,rows:a.data,schedules:s.data.map(s=>({...s,assignments:{...Object.fromEntries(s.assignments.map(a=>[a.position,a.user_id])),...Object.fromEntries((s.not_needed_cameras||[]).map(p=>[p,'not_needed']))}}))};
}
export async function uploadPhoto(userId,file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2*1024*1024)throw Error('Choose a JPG, PNG, or WebP under 2 MB.');const path=`${userId}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;const {error}=await db.storage.from('avatars').upload(path,file,{contentType:file.type});if(error)throw error;return path;}
export async function photoUrl(path){if(!path)return '';const {data,error}=await db.storage.from('avatars').createSignedUrl(path,3600);return error?'':data.signedUrl;}
// Check schema readiness without retrieving any member records.
export async function checkSetup(){
 const res=await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&limit=0`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY}});
 if(res.status===404){const body=await res.json();if(body.code==='PGRST205')return false;}
 if(res.status>=500)throw Error('The team database is temporarily unavailable. Try again shortly.');
 if(res.status===401){const body=await res.json();if(body.code!=='42501')throw Error('The project connection needs attention. Contact your administrator.');}
 return true;
}
