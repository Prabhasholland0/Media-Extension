// Data access. Uses Supabase when config.js is filled in, otherwise an in-browser sample workspace.
// The database enforces every permission; the sample workspace imitates the same rules.
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';
import {addDays,nextSunday,today,systemRoles,allPermissions} from './core.js';

export const live=Boolean(SUPABASE_URL&&SUPABASE_PUBLISHABLE_KEY)&&!new URLSearchParams(location.search).has('demo');
const unwrap=({data,error})=>{if(error)throw error;return data;};
let db;
const fail=msg=>{throw Error(msg);};
const orgColumns='id,name,time_zone,locale,contact_email,contact_phone,address,website,status,onboarded_at';

const supabaseStore={
 async init(){const {createClient}=await import('./vendor/supabase.js');db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);},
 async user(){const {data}=await db.auth.getSession();return data.session?.user||null;},
 onAuth(cb){db.auth.onAuthStateChange((event,session)=>cb(event,session?.user||null));},
 async signUp({name,email,password}){const data=unwrap(await db.auth.signUp({email,password,options:{data:{full_name:name,app:'mediahub-platform'},emailRedirectTo:location.origin+location.pathname}}));return {confirm:!data.session};},
 async signIn(email,password){unwrap(await db.auth.signInWithPassword({email,password}));},
 async signOut(){await db.auth.signOut();},
 async resetPassword(email){unwrap(await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname}));},
 async setPassword(password){unwrap(await db.auth.updateUser({password}));},
 async profile(){const u=await this.user();return unwrap(await db.from('profiles').select('id,full_name,email,phone').eq('id',u.id).single());},
 async updateProfile(name,phone){unwrap(await db.rpc('update_my_profile',{p_name:name,p_phone:phone}));},

 async orgs(){
  const u=await this.user();
  const rows=unwrap(await db.from('org_members').select('role,organizations(id,name,status,onboarded_at)').eq('user_id',u.id));
  return rows.filter(r=>r.organizations).map(r=>({...r.organizations,role:r.role})).sort((a,b)=>a.name.localeCompare(b.name));
 },
 async createOrg(name,preset){return unwrap(await db.rpc('create_organization',{p_name:name,p_preset:preset}));},
 async joinOrg(code){return unwrap(await db.rpc('join_organization',{p_code:code}))||fail('That invite code is not valid. Check it with your admin.');},
 async resetCode(org){return unwrap(await db.rpc('reset_join_code',{p_org:org}));},
 async updateOrg(org,patch){unwrap(await db.from('organizations').update(patch).eq('id',org));},
 async deleteOrg(org){unwrap(await db.from('organizations').delete().eq('id',org));},
 async transferOwnership(org,user){unwrap(await db.rpc('transfer_ownership',{p_org:org,p_user:user}));},
 async myInvitations(){return unwrap(await db.rpc('my_invitations'));},
 async answerInvitation(id,accept){return unwrap(await db.rpc('answer_invitation',{p_invitation:id,p_accept:accept}));},

 // Everything one organization's screens need, from 60 days ago onward.
 async loadOrg(org){
  const since=addDays(today(),-60);
  const q=(t,cols)=>db.from(t).select(cols).eq('org_id',org);
  const [profile,perms,roster,roles,campuses,teams,positions,memberPositions,departmentMembers,events,inviteCode,invitations,serviceTypes]=await Promise.all([
   db.from('organizations').select(orgColumns).eq('id',org).single(),db.rpc('my_permissions',{p_org:org}),
   db.rpc('org_roster',{p_org:org}),q('org_roles','key,name,permissions,is_system'),q('campuses','id,name,address,sort_order,archived_at'),
   q('teams','id,name,description,sort_order,archived_at'),q('positions','id,team_id,name,sort_order'),
   q('member_positions','user_id,position_id'),q('department_members','team_id,user_id,dept_role'),
   q('events','id,title,event_date,notes,status,campus_id,service_type_id,availability_open').gte('event_date',since).order('event_date'),
   db.rpc('org_invite_code',{p_org:org}),q('invitations','id,email,role,created_at').is('accepted_at',null).is('closed_at',null).order('created_at'),
   q('service_types','id,name,campus_id,weekday,services,needs,notes,archived_at,ask_availability').order('name')
  ]).then(r=>r.map(unwrap));
  const ids=events.map(e=>e.id);
  const none=['00000000-0000-0000-0000-000000000000'];
  const [services,needs,items]=await Promise.all([
   q('event_services','id,event_id,name,starts_at,sort_order').in('event_id',ids.length?ids:none),
   q('event_needs','event_id,position_id,quantity').in('event_id',ids.length?ids:none),
   q('plan_items','id,event_id,title,kind,duration_minutes,notes,sort_order').in('event_id',ids.length?ids:none)
  ]).then(r=>r.map(unwrap));
  const sids=services.map(s=>s.id);
  const [assignments,blockouts,availability,requests]=await Promise.all([
   q('plan_assignments','id,service_id,position_id,slot,user_id,status,replacement_requested_at,replacement_note').in('service_id',sids.length?sids:none),
   db.from('blockouts').select('user_id,day,reason').gte('day',since).in('user_id',roster.map(r=>r.user_id)),
   q('service_availability','service_id,user_id,status').in('service_id',sids.length?sids:none),
   db.rpc('availability_requests',{p_org:org})
  ]).then(r=>r.map(unwrap));
  return {profile,perms,roster,roles,campuses,teams,positions,memberPositions,departmentMembers,events,services,needs,items,assignments,blockouts,inviteCode,invitations,serviceTypes,availability,requests};
 },
 async auditLog(org){return unwrap(await db.from('audit_log').select('id,actor_id,action,entity,entity_id,detail,at').eq('org_id',org).order('at',{ascending:false}).limit(60));},

 async addCampus(org,c){unwrap(await db.from('campuses').insert({org_id:org,...c}));},
 async updateCampus(id,patch){unwrap(await db.from('campuses').update(patch).eq('id',id));},
 async saveRole(org,key,name,permissions){unwrap(await db.rpc('save_role',{p_org:org,p_key:key,p_name:name,p_permissions:permissions}));},
 async deleteRole(org,key){unwrap(await db.rpc('delete_role',{p_org:org,p_key:key}));},
 async invite(org,email,role){unwrap(await db.rpc('invite_member',{p_org:org,p_email:email,p_role:role}));},
 async revokeInvitation(id){unwrap(await db.rpc('revoke_invitation',{p_invitation:id}));},

 async addTeam(org,name,sort_order){unwrap(await db.from('teams').insert({org_id:org,name,sort_order}));},
 async updateTeam(id,patch){unwrap(await db.from('teams').update(patch).eq('id',id));},
 async deleteTeam(id){unwrap(await db.from('teams').delete().eq('id',id));},
 async setDepartmentMember(org,team_id,user_id,dept_role){
  if(dept_role)unwrap(await db.from('department_members').upsert({org_id:org,team_id,user_id,dept_role},{onConflict:'team_id,user_id'}));
  else unwrap(await db.from('department_members').delete().eq('team_id',team_id).eq('user_id',user_id));
 },
 async addPosition(org,team_id,name,sort_order){unwrap(await db.from('positions').insert({org_id:org,team_id,name,sort_order}));},
 async renamePosition(id,name){unwrap(await db.from('positions').update({name}).eq('id',id));},
 async deletePosition(id){unwrap(await db.from('positions').delete().eq('id',id));},

 async setRole(org,user,role){unwrap(await db.rpc('set_member_role',{p_org:org,p_user:user,p_role:role}));},
 async removeMember(org,user){unwrap(await db.rpc('remove_member',{p_org:org,p_user:user}));},
 async setMemberPositions(org,user,ids){
  unwrap(await db.from('member_positions').delete().eq('org_id',org).eq('user_id',user));
  if(ids.length)unwrap(await db.from('member_positions').insert(ids.map(position_id=>({org_id:org,user_id:user,position_id}))));
 },

 async createEvent(org,event){return unwrap(await db.rpc('create_event',{p_org:org,p_event:event}));},
 async addServiceType(org,t){unwrap(await db.from('service_types').insert({org_id:org,...t}));},
 async updateServiceType(id,patch){unwrap(await db.from('service_types').update(patch).eq('id',id));},
 async deleteServiceType(id){unwrap(await db.from('service_types').delete().eq('id',id));},
 async createFromType(id,from,count){return unwrap(await db.rpc('create_events_from_type',{p_type:id,p_from:from,p_count:count}));},
 async updateEvent(id,patch){unwrap(await db.from('events').update(patch).eq('id',id));},
 async deleteEvent(id){unwrap(await db.from('events').delete().eq('id',id));},
 async duplicateEvent(id,date){return unwrap(await db.rpc('duplicate_event',{p_event:id,p_date:date}));},
 async addService(org,event_id,s){unwrap(await db.from('event_services').insert({org_id:org,event_id,...s}));},
 async updateService(id,patch){unwrap(await db.from('event_services').update(patch).eq('id',id));},
 async deleteService(id){unwrap(await db.from('event_services').delete().eq('id',id));},
 async setNeed(org,event_id,position_id,quantity){
  if(quantity>0)unwrap(await db.from('event_needs').upsert({org_id:org,event_id,position_id,quantity},{onConflict:'event_id,position_id'}));
  else unwrap(await db.from('event_needs').delete().eq('event_id',event_id).eq('position_id',position_id));
 },
 async addItem(org,event_id,item){unwrap(await db.from('plan_items').insert({org_id:org,event_id,...item}));},
 async updateItem(id,patch){unwrap(await db.from('plan_items').update(patch).eq('id',id));},
 async deleteItem(id){unwrap(await db.from('plan_items').delete().eq('id',id));},
 async saveAssignments(service,list){unwrap(await db.rpc('save_service_assignments',{p_service:service,p_assignments:list}));},
 async respond(id,status){unwrap(await db.rpc('respond_assignment',{p_assignment:id,p_status:status}));},
 async setAvailability(service,status){unwrap(await db.rpc('set_availability',{p_service:service,p_status:status}));},
 async requestReplacement(id,note){unwrap(await db.rpc('request_replacement',{p_assignment:id,p_note:note}));},
 async cancelReplacement(id){unwrap(await db.rpc('cancel_replacement',{p_assignment:id}));},
 async takeReplacement(id){unwrap(await db.rpc('take_replacement',{p_assignment:id}));},
 async notifications(){return unwrap(await db.from('notifications').select('id,org_id,kind,title,body,event_id,created_at,read_at').order('created_at',{ascending:false}).limit(40));},
 async markRead(ids){unwrap(await db.rpc('mark_notifications_read',{p_ids:ids}));},
 async addBlockout(day,reason){const u=await this.user();unwrap(await db.from('blockouts').upsert({user_id:u.id,day,reason}));},
 async deleteBlockout(day){const u=await this.user();unwrap(await db.from('blockouts').delete().eq('user_id',u.id).eq('day',day));},

 async isPlatformAdmin(){return unwrap(await db.rpc('is_platform_admin'));},
 async platformOrgs(){return unwrap(await db.rpc('platform_organizations'));},
 async setOrgStatus(org,status){unwrap(await db.rpc('set_organization_status',{p_org:org,p_status:status}));}
};

// ---- Sample workspace: same interface, kept in memory for this visit only. ----
const uid=()=>crypto.randomUUID();
const demo={users:[],profiles:[],orgs:[],members:[],roles:[],campuses:[],teams:[],deptMembers:[],positions:[],memberPositions:[],events:[],services:[],needs:[],items:[],assignments:[],blockouts:[],invitations:[],audit:[],serviceTypes:[],notifications:[],availability:[],me:null};
const role=org=>demo.members.find(m=>m.org_id===org&&m.user_id===demo.me)?.role;
const perms=org=>{const r=role(org),o=demo.orgs.find(o=>o.id===org);if(!r||o?.status!=='active')return [];return r==='owner'?allPermissions:demo.roles.find(x=>x.org_id===org&&x.key===r)?.permissions||[];};
const need=(org,p)=>perms(org).includes(p)||fail('You do not have permission to do that');
const leads=(org,team)=>demo.orgs.find(o=>o.id===org)?.status==='active'&&demo.deptMembers.some(d=>d.org_id===org&&(!team||d.team_id===team)&&d.user_id===demo.me&&d.dept_role!=='member');
const canSchedule=(org,position)=>perms(org).includes('schedule.manage')||leads(org,demo.positions.find(p=>p.id===position)?.team_id);
const subset=(a,b)=>a.every(x=>b.includes(x));
const active=org=>demo.orgs.find(o=>o.id===org)?.status==='active';
const fullName=u=>demo.profiles.find(p=>p.id===u)?.full_name||'Someone';
// Mirrors schedulers_for(), notify() and assignment_context() in 007_scheduling.sql.
const schedulersFor=(org,position)=>{const team=demo.positions.find(p=>p.id===position)?.team_id;
 return demo.members.filter(m=>m.org_id===org&&(m.role==='owner'||demo.roles.find(r=>r.org_id===org&&r.key===m.role)?.permissions.includes('schedule.manage')
  ||demo.deptMembers.some(d=>d.org_id===org&&d.user_id===m.user_id&&d.team_id===team&&d.dept_role!=='member'))).map(m=>m.user_id);};
const notify=(users,org,kind,title,body,event_id)=>[...new Set(users)].filter(u=>u&&u!==demo.me&&demo.members.some(m=>m.org_id===org&&m.user_id===u))
 .forEach(user_id=>demo.notifications.unshift({id:uid(),user_id,org_id:org,kind,title,body,event_id,created_at:new Date().toISOString(),read_at:null}));
const context=a=>{const s=demo.services.find(s=>s.id===a.service_id),e=demo.events.find(e=>e.id===s.event_id),p=demo.positions.find(p=>p.id===a.position_id);
 return {e,s,label:`${p.name} · ${e.title}, ${new Date(`${e.event_date}T12:00:00`).toLocaleDateString('en',{weekday:'short',day:'2-digit',month:'short'})} · ${s.name}`};};
// Mirrors availability_requests(): open upcoming events with my answers, without their roster or plan.
const availabilityRequests=org=>demo.events.filter(e=>e.org_id===org&&e.availability_open&&['draft','published'].includes(e.status)&&e.event_date>=today())
 .flatMap(e=>demo.services.filter(s=>s.event_id===e.id).map(s=>({event_id:e.id,title:e.title,event_date:e.event_date,campus_id:e.campus_id,service_id:s.id,service_name:s.name,starts_at:s.starts_at,sort_order:s.sort_order,
  status:demo.availability.find(a=>a.service_id===s.id&&a.user_id===demo.me)?.status||null})))
 .sort((a,b)=>a.event_date.localeCompare(b.event_date)||a.sort_order-b.sort_order);
const log=(org,action,entity,entity_id,detail={})=>demo.audit.unshift({id:demo.audit.length+1,org_id:org,actor_id:demo.me,action,entity,entity_id,detail,at:new Date().toISOString()});
const presetTeams={media:{Video:['Producer','Director','CCU','Camera','Graphics'],Audio:['Front of House','Monitors'],Lighting:['Lighting Operator']},
 church:{Media:['Producer','Camera','Graphics','Sound'],Worship:['Worship Leader','Vocals','Keys','Guitar','Bass','Drums'],Hospitality:['Greeter','Usher']},blank:{}};
const code=()=>uid().replaceAll('-','').slice(0,8).toUpperCase();

function seedDemo(){
 const names=['Alex Morgan','Sherlyn Paul','Caleb Joseph','Meghana Rao','Arpan Das','Natasha Roy','Emmanuel K','Sidhu Varma','Austin Lee','Jairus M'];
 for(const [i,full_name] of names.entries()){const id=uid();demo.users.push({id,email:`member${i}@example.com`});demo.profiles.push({id,full_name,email:i?`member${i}@example.com`:'you@example.com',phone:''});}
 demo.me=demo.profiles[0].id;
 const org=demoStore.createOrg('Sample Media Team','media');
 Object.assign(demo.orgs.find(o=>o.id===org),{onboarded_at:new Date().toISOString(),contact_email:'office@example.com'});
 demo.profiles.slice(1).forEach((p,i)=>demo.members.push({org_id:org,user_id:p.id,role:i===0?'admin':i===1?'scheduler':'member',joined_at:new Date().toISOString()}));
 demo.campuses.push({id:uid(),org_id:org,name:'Main campus',address:'',sort_order:1,archived_at:null});
 const pos=n=>demo.positions.find(p=>p.org_id===org&&p.name===n).id;
 const video=demo.teams.find(t=>t.org_id===org&&t.name==='Video');
 video.description='Cameras, switching and live stream for every service.';
 demo.deptMembers.push({org_id:org,team_id:video.id,user_id:demo.profiles[3].id,dept_role:'leader'});
 const skills=[['Producer','Director'],['Producer','Camera'],['CCU','Camera'],['Camera','Graphics'],['Camera'],['Camera','Front of House'],['Graphics','Monitors'],['Camera','Lighting Operator'],['Front of House','CCU'],['Camera','Director']];
 demo.profiles.forEach((p,i)=>skills[i].forEach(n=>demo.memberPositions.push({org_id:org,user_id:p.id,position_id:pos(n)})));
 const sunday=nextSunday();
 const ev=demoStore.createEvent(org,{title:'Sunday Gathering',event_date:sunday,notes:'Communion Sunday. Arrive 60 minutes before service.',campus_id:demo.campuses[0].id,
  services:[{name:'First Service',starts_at:'09:00'},{name:'Second Service',starts_at:'11:30'}],
  needs:[['Producer',1],['Director',1],['CCU',1],['Camera',3],['Graphics',1],['Front of House',1]].map(([n,quantity])=>({position_id:pos(n),quantity}))});
 demo.events.find(e=>e.id===ev).status='published';
 [['Pre-service countdown','media',5],['Welcome','item',3],['Worship','header',0],['Way Maker','song',6],['Goodness of God','song',5],['Announcements','media',4],['Sermon','message',35],['Closing prayer','item',3]]
  .forEach(([title,kind,duration_minutes],i)=>demo.items.push({id:uid(),org_id:org,event_id:ev,title,kind,duration_minutes,notes:'',sort_order:i+1}));
 const first=demo.services.find(s=>s.event_id===ev&&s.sort_order===1).id;
 [['Producer',1,1,'accepted'],['Director',1,9,'pending'],['CCU',1,2,'accepted'],['Camera',1,4,'accepted'],['Camera',2,3,'declined'],['Graphics',1,6,'pending']]
  .forEach(([n,slot,who,status])=>demo.assignments.push({id:uid(),org_id:org,service_id:first,position_id:pos(n),slot,user_id:demo.profiles[who].id,status}));
 demo.assignments.push({id:uid(),org_id:org,service_id:first,position_id:pos('Front of House'),slot:1,user_id:demo.me,status:'pending'});
 demoStore.createEvent(org,{title:'Youth Night',event_date:addDays(sunday,5),notes:'',services:[{name:'Service',starts_at:'19:00'}],
  needs:[['Producer',1],['Camera',2],['Front of House',1]].map(([n,quantity])=>({position_id:pos(n),quantity}))});
 demo.blockouts.push({user_id:demo.profiles[5].id,day:sunday,reason:'Travelling'});
 demo.invitations.push({id:uid(),org_id:org,email:'new.volunteer@example.com',role:'member',created_at:new Date().toISOString(),accepted_at:null,closed_at:null});
 // An invitation waiting for the sample owner from another church.
 const other=uid();demo.orgs.push({id:other,name:'Grace Community Church',join_code:code(),status:'active',time_zone:'Asia/Kolkata',locale:'en',contact_email:'',contact_phone:'',address:'',website:'',onboarded_at:null});
 systemRoles.forEach(r=>demo.roles.push({org_id:other,...r,is_system:true}));
 demo.invitations.push({id:uid(),org_id:other,email:'you@example.com',role:'scheduler',created_at:new Date().toISOString(),accepted_at:null,closed_at:null});
 const second=demo.services.find(s=>s.event_id===ev&&s.sort_order===2).id;
 demo.assignments.push({id:uid(),org_id:org,service_id:second,position_id:pos('Director'),slot:1,user_id:demo.profiles[9].id,status:'accepted',replacement_requested_at:new Date().toISOString(),replacement_note:'Family visit this weekend'});
 demo.assignments.forEach(a=>{a.replacement_requested_at??=null;a.replacement_note??='';});
 demo.serviceTypes.push({id:uid(),org_id:org,name:'Sunday Gathering',campus_id:demo.campuses[0].id,weekday:0,services:[{name:'First Service',starts_at:'09:00'},{name:'Second Service',starts_at:'11:30'}],
  needs:demo.needs.filter(n=>n.event_id===ev).map(({position_id,quantity})=>({position_id,quantity})),notes:'',archived_at:null});
 demo.events.find(e=>e.id===ev).service_type_id=demo.serviceTypes[0].id;
 const at=Date.now();
 demo.notifications.push({id:uid(),user_id:demo.me,org_id:org,kind:'replacement_requested',title:'Jairus M needs a replacement',body:'Director · Sunday Gathering · Second Service',event_id:ev,created_at:new Date(at-3600e3).toISOString(),read_at:null},
  {id:uid(),user_id:demo.me,org_id:org,kind:'declined',title:'Caleb Joseph declined',body:'Camera · Sunday Gathering · First Service',event_id:ev,created_at:new Date(at-7200e3).toISOString(),read_at:null},
  {id:uid(),user_id:demo.me,org_id:org,kind:'scheduled',title:'You have been scheduled',body:'Front of House · Sunday Gathering · First Service',event_id:ev,created_at:new Date(at-86400e3).toISOString(),read_at:new Date(at-80000e3).toISOString()});
 const youth=demo.events.find(e=>e.org_id===org&&e.title==='Youth Night'),ysvc=demo.services.find(s=>s.event_id===youth.id).id;
 youth.availability_open=true;
 [[1,'available'],[2,'available'],[4,'not_available'],[5,'available'],[7,'available']].forEach(([i,status])=>demo.availability.push({org_id:org,service_id:ysvc,user_id:demo.profiles[i].id,status}));
 demo.serviceTypes[0].ask_availability=true;
 demo.audit=[];
}

const demoStore={
 async init(){seedDemo();},
 async user(){return demo.me?demo.users.find(u=>u.id===demo.me)||{id:demo.me}:null;},
 onAuth(){},
 async signUp(){return {confirm:false};},async signIn(){},async signOut(){},async resetPassword(){},async setPassword(){},
 async profile(){return demo.profiles.find(p=>p.id===demo.me);},
 async updateProfile(name,phone){Object.assign(await this.profile(),{full_name:name.trim(),phone:phone.trim()});},
 // Sample-only: look at the workspace as another member.
 actAs(id){demo.me=id;},people:()=>demo.profiles,
 async orgs(){return demo.members.filter(m=>m.user_id===demo.me).map(m=>{const o=demo.orgs.find(o=>o.id===m.org_id);return {id:o.id,name:o.name,status:o.status,onboarded_at:o.onboarded_at,role:m.role};}).sort((a,b)=>a.name.localeCompare(b.name));},
 createOrg(name,preset){
  const id=uid();demo.orgs.push({id,name:name.trim(),join_code:code(),status:'active',time_zone:'Asia/Kolkata',locale:'en',contact_email:'',contact_phone:'',address:'',website:'',onboarded_at:null});
  systemRoles.forEach(r=>demo.roles.push({org_id:id,...r,is_system:true}));
  demo.members.push({org_id:id,user_id:demo.me,role:'owner',joined_at:new Date().toISOString()});
  Object.entries(presetTeams[preset]).forEach(([team,list],i)=>{const tid=uid();demo.teams.push({id:tid,org_id:id,name:team,description:'',sort_order:i+1,archived_at:null});
   list.forEach((name,j)=>demo.positions.push({id:uid(),org_id:id,team_id:tid,name,sort_order:j+1}));});
  return id;
 },
 async joinOrg(c){const o=demo.orgs.find(o=>o.join_code===c.trim().toUpperCase())||fail('That invite code is not valid. Check it with your admin.');if(!role(o.id))demo.members.push({org_id:o.id,user_id:demo.me,role:'member',joined_at:new Date().toISOString()});return o.id;},
 async resetCode(org){need(org,'members.manage');return demo.orgs.find(o=>o.id===org).join_code=code();},
 async updateOrg(org,patch){need(org,'org.manage');Object.assign(demo.orgs.find(o=>o.id===org),patch);log(org,'update','organizations',org,patch);},
 async deleteOrg(org){role(org)==='owner'||fail('Only the owner can delete');demo.orgs=demo.orgs.filter(o=>o.id!==org);demo.members=demo.members.filter(m=>m.org_id!==org);},
 async transferOwnership(org,user){role(org)==='owner'||fail('Only the owner can transfer ownership');
  demo.members.find(m=>m.org_id===org&&m.user_id===demo.me).role='admin';demo.members.find(m=>m.org_id===org&&m.user_id===user).role='owner';log(org,'update','org_members',user,{role:'owner'});},
 async myInvitations(){const me=demo.profiles.find(p=>p.id===demo.me).email;
  return demo.invitations.filter(i=>i.email===me&&!i.accepted_at&&!i.closed_at&&!role(i.org_id)).map(i=>({id:i.id,org_id:i.org_id,org_name:demo.orgs.find(o=>o.id===i.org_id).name,role_name:demo.roles.find(r=>r.org_id===i.org_id&&r.key===i.role).name,invited_by_name:'',created_at:i.created_at}));},
 async answerInvitation(id,accept){const i=demo.invitations.find(i=>i.id===id)||fail('Invitation not found');
  if(accept){demo.members.push({org_id:i.org_id,user_id:demo.me,role:i.role,joined_at:new Date().toISOString()});i.accepted_at=new Date().toISOString();return i.org_id;}
  i.closed_at=new Date().toISOString();return null;},
 async loadOrg(org){
  const p=perms(org),seeDrafts=p.includes('events.manage')||p.includes('schedule.manage')||leads(org),contact=p.includes('members.contact.read');
  const of=t=>structuredClone(demo[t].filter(r=>r.org_id===org));
  const events=of('events').filter(e=>seeDrafts||e.status!=='draft').sort((a,b)=>a.event_date.localeCompare(b.event_date));
  const ids=new Set(events.map(e=>e.id)),services=of('services').filter(s=>ids.has(s.event_id)),sids=new Set(services.map(s=>s.id));
  const roster=demo.members.filter(m=>m.org_id===org).map(m=>{const pr=demo.profiles.find(x=>x.id===m.user_id);const own=contact||pr.id===demo.me;
   return {user_id:pr.id,full_name:pr.full_name,email:own?pr.email:'',phone:own?pr.phone:'',role:m.role,joined_at:m.joined_at};}).sort((a,b)=>a.full_name.localeCompare(b.full_name));
  const people=new Set(roster.map(r=>r.user_id)),o=demo.orgs.find(o=>o.id===org);
  const {join_code,...profile}=o;
  return {profile:structuredClone(profile),perms:[...p],roster,roles:of('roles'),campuses:of('campuses'),teams:of('teams'),positions:of('positions'),memberPositions:of('memberPositions'),
   departmentMembers:of('deptMembers'),events,services,needs:of('needs').filter(n=>ids.has(n.event_id)),items:of('items').filter(i=>ids.has(i.event_id)),
   assignments:of('assignments').filter(a=>sids.has(a.service_id)||a.user_id===demo.me),
   blockouts:structuredClone(demo.blockouts.filter(b=>people.has(b.user_id)&&(p.includes('schedule.manage')||leads(org)||b.user_id===demo.me))),
   inviteCode:p.includes('members.manage')?join_code:null,
   invitations:p.includes('members.manage')?of('invitations').filter(i=>!i.accepted_at&&!i.closed_at):[],serviceTypes:of('serviceTypes'),
   availability:structuredClone(demo.availability.filter(a=>a.org_id===org&&(p.includes('schedule.manage')||leads(org)||a.user_id===demo.me))),
   requests:role(org)?availabilityRequests(org):[]};
 },
 async auditLog(org){need(org,'audit.read');return structuredClone(demo.audit.filter(a=>a.org_id===org).slice(0,60));},
 async addCampus(org,c){need(org,'campuses.manage');const id=uid();demo.campuses.push({id,org_id:org,address:'',archived_at:null,...c});log(org,'insert','campuses',id,c);},
 async updateCampus(id,patch){const c=demo.campuses.find(c=>c.id===id);need(c.org_id,'campuses.manage');Object.assign(c,patch);log(c.org_id,'update','campuses',id,patch);},
 async saveRole(org,key,name,permissions){need(org,'roles.manage');key==='owner'&&fail('The owner role cannot be edited');
  subset(permissions,perms(org))||fail('You cannot give a role permissions you do not have');
  const r=demo.roles.find(r=>r.org_id===org&&r.key===key);if(r)Object.assign(r,{name,permissions});else demo.roles.push({org_id:org,key,name,permissions,is_system:false});log(org,r?'update':'insert','org_roles',key,{name,permissions});},
 async deleteRole(org,key){need(org,'roles.manage');const r=demo.roles.find(r=>r.org_id===org&&r.key===key);r.is_system&&fail('Built-in roles cannot be deleted');
  demo.members.some(m=>m.org_id===org&&m.role===key)&&fail('Move everyone out of this role first');demo.roles=demo.roles.filter(x=>x!==r);log(org,'delete','org_roles',key);},
 async invite(org,email,r){need(org,'members.manage');const mail=email.trim().toLowerCase();
  demo.members.some(m=>m.org_id===org&&demo.profiles.find(p=>p.id===m.user_id).email===mail)&&fail('That person is already a member');
  const open=demo.invitations.find(i=>i.org_id===org&&i.email===mail&&!i.accepted_at&&!i.closed_at);
  if(open)open.role=r;else demo.invitations.push({id:uid(),org_id:org,email:mail,role:r,created_at:new Date().toISOString(),accepted_at:null,closed_at:null});log(org,'insert','invitations',mail,{role:r});},
 async revokeInvitation(id){const i=demo.invitations.find(i=>i.id===id);need(i.org_id,'members.manage');i.closed_at=new Date().toISOString();},
 async addTeam(org,name,sort_order){need(org,'departments.manage');const id=uid();demo.teams.push({id,org_id:org,name,description:'',sort_order,archived_at:null});log(org,'insert','teams',id,{name});},
 async updateTeam(id,patch){const t=demo.teams.find(t=>t.id===id);need(t.org_id,'departments.manage');Object.assign(t,patch);log(t.org_id,'update','teams',id,patch);},
 async deleteTeam(id){const t=demo.teams.find(t=>t.id===id);need(t.org_id,'departments.manage');demo.positions.filter(p=>p.team_id===id).forEach(p=>this.deletePosition(p.id));demo.deptMembers=demo.deptMembers.filter(d=>d.team_id!==id);demo.teams=demo.teams.filter(x=>x.id!==id);log(t.org_id,'delete','teams',id);},
 async setDepartmentMember(org,team_id,user_id,dept_role){need(org,'departments.manage');demo.deptMembers=demo.deptMembers.filter(d=>!(d.team_id===team_id&&d.user_id===user_id));
  if(dept_role)demo.deptMembers.push({org_id:org,team_id,user_id,dept_role});log(org,dept_role?'insert':'delete','department_members',user_id,{dept_role});},
 async addPosition(org,team_id,name,sort_order){need(org,'departments.manage');demo.positions.push({id:uid(),org_id:org,team_id,name,sort_order});},
 async renamePosition(id,name){const p=demo.positions.find(p=>p.id===id);need(p.org_id,'departments.manage');p.name=name;},
 deletePosition(id){const p=demo.positions.find(p=>p.id===id);need(p.org_id,'departments.manage');
  for(const t of ['memberPositions','needs','assignments'])demo[t]=demo[t].filter(r=>r.position_id!==id);demo.positions=demo.positions.filter(x=>x.id!==id);},
 async setRole(org,user,r){need(org,'members.manage');user===demo.me&&fail('You cannot change your own role');const m=demo.members.find(m=>m.org_id===org&&m.user_id===user);m.role==='owner'&&fail('The owner role cannot be changed here');
  (r!=='owner'&&subset(demo.roles.find(x=>x.org_id===org&&x.key===r).permissions,perms(org)))||fail('You cannot give a role with permissions you do not have');m.role=r;log(org,'update','org_members',user,{role:r});},
 async removeMember(org,user){user===demo.me||need(org,'members.manage');demo.members.find(m=>m.org_id===org&&m.user_id===user)?.role==='owner'&&fail('The owner cannot be removed. Transfer ownership or delete the organization instead.');
  demo.members=demo.members.filter(m=>!(m.org_id===org&&m.user_id===user));for(const t of ['memberPositions','deptMembers','assignments','notifications'])demo[t]=demo[t].filter(m=>!(m.org_id===org&&m.user_id===user));log(org,'delete','org_members',user);},
 async setMemberPositions(org,user,ids){need(org,'departments.manage');demo.memberPositions=demo.memberPositions.filter(m=>!(m.org_id===org&&m.user_id===user)).concat(ids.map(position_id=>({org_id:org,user_id:user,position_id})));},
 createEvent(org,{title,event_date,notes='',campus_id=null,service_type_id=null,services=[],needs=[],availability_open=false}){
  need(org,'events.manage');const id=uid();demo.events.push({id,org_id:org,title,event_date,notes,campus_id:campus_id||null,service_type_id,status:'draft',availability_open:false});
  services.forEach((s,i)=>demo.services.push({id:uid(),org_id:org,event_id:id,name:s.name,starts_at:s.starts_at||null,sort_order:i+1}));
  needs.forEach(n=>demo.needs.push({org_id:org,event_id:id,position_id:n.position_id,quantity:n.quantity}));
  log(org,'insert','events',id,{title,event_date});if(availability_open)this.updateEvent(id,{availability_open:true});return id;
 },
 async updateEvent(id,patch){const e=demo.events.find(e=>e.id===id);need(e.org_id,'events.manage');const was=e.status,wasOpen=e.availability_open;Object.assign(e,patch);log(e.org_id,'update','events',id,patch);
  const mine=demo.assignments.filter(a=>demo.services.some(s=>s.id===a.service_id&&s.event_id===id));
  if(e.status==='published'&&was==='draft')mine.filter(a=>a.status==='pending').forEach(a=>notify([a.user_id],e.org_id,'scheduled','You have been scheduled',context(a).label,id));
  if(patch.availability_open&&!wasOpen&&['draft','published'].includes(e.status)&&e.event_date>=today()){const need=new Set(demo.needs.filter(n=>n.event_id===id).map(n=>n.position_id));
   notify(demo.memberPositions.filter(m=>need.has(m.position_id)).map(m=>m.user_id),e.org_id,'availability',`Are you available for ${e.title}?`,e.event_date,id);}
  if(e.status==='cancelled'&&was!=='cancelled')notify(mine.filter(a=>a.status!=='declined').map(a=>a.user_id),e.org_id,'cancelled',`${e.title} is cancelled`,e.event_date,id);},
 async addServiceType(org,t){need(org,'events.manage');const id=uid();demo.serviceTypes.push({id,org_id:org,campus_id:null,weekday:null,services:[],needs:[],notes:'',archived_at:null,ask_availability:false,...t});log(org,'insert','service_types',id,{name:t.name});},
 async updateServiceType(id,patch){const t=demo.serviceTypes.find(t=>t.id===id);need(t.org_id,'events.manage');Object.assign(t,patch);log(t.org_id,'update','service_types',id,patch);},
 async deleteServiceType(id){const t=demo.serviceTypes.find(t=>t.id===id);need(t.org_id,'events.manage');demo.serviceTypes=demo.serviceTypes.filter(x=>x!==t);demo.events.forEach(e=>{if(e.service_type_id===id)e.service_type_id=null;});log(t.org_id,'delete','service_types',id,{name:t.name});},
 async createFromType(id,from,count){const t=demo.serviceTypes.find(t=>t.id===id);need(t.org_id,'events.manage');t.weekday==null&&fail('Choose the day of the week this service happens');
  (count>=1&&count<=26)||fail('Choose between 1 and 26 weeks');let d=addDays(from,(t.weekday-new Date(`${from}T12:00:00`).getDay()+7)%7),made=0;
  for(let i=0;i<count;i++,d=addDays(d,7))if(!demo.events.some(e=>e.service_type_id===id&&e.event_date===d)){
   this.createEvent(t.org_id,{title:t.name,event_date:d,notes:t.notes,campus_id:t.campus_id,service_type_id:id,availability_open:t.ask_availability,services:t.services,needs:t.needs.filter(n=>demo.positions.some(p=>p.id===n.position_id))});made++;}
  return made;},
 async deleteEvent(id){const e=demo.events.find(e=>e.id===id);need(e.org_id,'events.manage');const sids=demo.services.filter(s=>s.event_id===id).map(s=>s.id);
  demo.assignments=demo.assignments.filter(a=>!sids.includes(a.service_id));for(const t of ['services','needs','items'])demo[t]=demo[t].filter(r=>r.event_id!==id);demo.events=demo.events.filter(e=>e.id!==id);log(e.org_id,'delete','events',id,{title:e.title});},
 async duplicateEvent(id,date){const e=demo.events.find(e=>e.id===id);
  const nid=this.createEvent(e.org_id,{title:e.title,event_date:date,notes:e.notes,campus_id:e.campus_id,services:demo.services.filter(s=>s.event_id===id).sort((a,b)=>a.sort_order-b.sort_order),needs:demo.needs.filter(n=>n.event_id===id)});
  demo.items.filter(i=>i.event_id===id).forEach(i=>demo.items.push({...i,id:uid(),event_id:nid}));return nid;},
 async addService(org,event_id,s){need(org,'events.manage');demo.services.push({id:uid(),org_id:org,event_id,...s});},
 async updateService(id,patch){const s=demo.services.find(s=>s.id===id);need(s.org_id,'events.manage');Object.assign(s,patch);},
 async deleteService(id){const s=demo.services.find(s=>s.id===id);need(s.org_id,'events.manage');demo.services=demo.services.filter(x=>x.id!==id);demo.assignments=demo.assignments.filter(a=>a.service_id!==id);},
 async setNeed(org,event_id,position_id,quantity){need(org,'events.manage');demo.needs=demo.needs.filter(n=>!(n.event_id===event_id&&n.position_id===position_id));
  if(quantity>0)demo.needs.push({org_id:org,event_id,position_id,quantity});
  const sids=demo.services.filter(s=>s.event_id===event_id).map(s=>s.id);
  demo.assignments=demo.assignments.filter(a=>!(sids.includes(a.service_id)&&a.position_id===position_id&&a.slot>quantity));},
 async addItem(org,event_id,item){need(org,'events.manage');demo.items.push({id:uid(),org_id:org,event_id,notes:'',...item});},
 async updateItem(id,patch){const i=demo.items.find(i=>i.id===id);need(i.org_id,'events.manage');Object.assign(i,patch);},
 async deleteItem(id){const i=demo.items.find(i=>i.id===id);need(i.org_id,'events.manage');demo.items=demo.items.filter(x=>x.id!==id);},
 // Mirrors save_service_assignments: seats the caller cannot schedule keep their current people.
 async saveAssignments(service,list){
  const s=demo.services.find(s=>s.id===service),org=s.org_id;
  (perms(org).includes('schedule.manage')||leads(org))||fail('You do not have permission to schedule people');
  const fixed=demo.assignments.filter(a=>a.service_id===service&&!canSchedule(org,a.position_id)).map(({position_id,slot,user_id})=>({position_id,slot,user_id}));
  const all=list.filter(n=>canSchedule(org,n.position_id)).concat(fixed);
  new Set(all.map(a=>a.user_id)).size===all.length||fail('A person can hold only one position per service');
  const keep=demo.assignments.filter(a=>a.service_id===service&&all.some(n=>n.position_id===a.position_id&&n.slot===a.slot&&n.user_id===a.user_id));
  demo.assignments=demo.assignments.filter(a=>a.service_id!==service).concat(keep,
   all.filter(n=>!keep.some(a=>a.position_id===n.position_id&&a.slot===n.slot)).map(n=>({id:uid(),org_id:org,service_id:service,...n,status:'pending',replacement_requested_at:null,replacement_note:''})));
  demo.assignments.filter(a=>a.service_id===service&&!keep.includes(a)).forEach(a=>{const c=context(a);if(c.e.status==='published')notify([a.user_id],org,'scheduled','You have been scheduled',c.label,c.e.id);});
  log(org,'update','plan_assignments',service,{seats:all.length});
 },
 async respond(id,status){const a=demo.assignments.find(a=>a.id===id&&a.user_id===demo.me)||fail('Assignment not found'),c=context(a);
  ['cancelled','completed'].includes(c.e.status)&&fail(`This event is ${c.e.status}`);active(a.org_id)||fail('This organization is suspended');
  const was=a.status;Object.assign(a,{status,replacement_requested_at:null,replacement_note:''});
  if(status==='declined'&&was!=='declined'&&c.e.status==='published')notify(schedulersFor(a.org_id,a.position_id),a.org_id,'declined',`${fullName(a.user_id)} declined`,c.label,c.e.id);},
 async setAvailability(service,status){const s=demo.services.find(s=>s.id===service),e=s&&demo.events.find(e=>e.id===s.event_id);(e&&role(e.org_id))||fail('Service not found');
  (e.availability_open&&['draft','published'].includes(e.status)&&e.event_date>=today())||fail('This event is not asking for availability');active(e.org_id)||fail('This organization is suspended');
  demo.availability=demo.availability.filter(a=>!(a.service_id===service&&a.user_id===demo.me)).concat({org_id:e.org_id,service_id:service,user_id:demo.me,status});},
 async requestReplacement(id,note){const a=demo.assignments.find(a=>a.id===id&&a.user_id===demo.me)||fail('Assignment not found'),c=context(a);
  (c.e.status==='published'&&c.e.event_date>=today())||fail('You can ask for a replacement only for an upcoming published event');active(a.org_id)||fail('This organization is suspended');
  Object.assign(a,{replacement_requested_at:new Date().toISOString(),replacement_note:note.trim().slice(0,200)});
  const free=demo.memberPositions.filter(m=>m.org_id===a.org_id&&m.position_id===a.position_id&&!demo.assignments.some(x=>x.service_id===a.service_id&&x.user_id===m.user_id)&&!demo.blockouts.some(b=>b.user_id===m.user_id&&b.day===c.e.event_date)).map(m=>m.user_id);
  notify([...schedulersFor(a.org_id,a.position_id),...free],a.org_id,'replacement_requested',`${fullName(a.user_id)} needs a replacement`,c.label,c.e.id);},
 async cancelReplacement(id){const a=demo.assignments.find(a=>a.id===id&&a.user_id===demo.me)||fail('Assignment not found');Object.assign(a,{replacement_requested_at:null,replacement_note:''});},
 async takeReplacement(id){const a=demo.assignments.find(a=>a.id===id);(a&&a.replacement_requested_at)||fail('This spot is no longer open');const c=context(a);
  (c.e.status==='published'&&c.e.event_date>=today())||fail('This spot is no longer open');a.user_id===demo.me&&fail('This is already your spot');active(a.org_id)||fail('This organization is suspended');
  demo.memberPositions.some(m=>m.org_id===a.org_id&&m.user_id===demo.me&&m.position_id===a.position_id)||fail('You are not set up for this position');
  demo.assignments.some(x=>x.service_id===a.service_id&&x.user_id===demo.me)&&fail('You are already serving in this service');
  const from=a.user_id;Object.assign(a,{user_id:demo.me,status:'accepted',replacement_requested_at:null,replacement_note:''});
  notify([from],a.org_id,'replacement_taken','Your spot is covered',`${fullName(demo.me)} took ${c.label}`,c.e.id);
  notify(schedulersFor(a.org_id,a.position_id).filter(u=>u!==from),a.org_id,'replacement_taken',`${fullName(demo.me)} covered a spot`,c.label,c.e.id);log(a.org_id,'update','plan_assignments',a.id,{user_id:demo.me});},
 async notifications(){return structuredClone(demo.notifications.filter(n=>n.user_id===demo.me).slice(0,40));},
 async markRead(ids){demo.notifications.forEach(n=>{if(n.user_id===demo.me&&!n.read_at&&(!ids||ids.includes(n.id)))n.read_at=new Date().toISOString();});},
 async addBlockout(day,reason){demo.blockouts=demo.blockouts.filter(b=>!(b.user_id===demo.me&&b.day===day)).concat({user_id:demo.me,day,reason});},
 async deleteBlockout(day){demo.blockouts=demo.blockouts.filter(b=>!(b.user_id===demo.me&&b.day===day));},
 async isPlatformAdmin(){return demo.me===demo.profiles[0].id;},
 async platformOrgs(){return demo.orgs.map(o=>({id:o.id,name:o.name,status:o.status,created_at:new Date().toISOString(),members:demo.members.filter(m=>m.org_id===o.id).length,events:demo.events.filter(e=>e.org_id===o.id).length}));},
 async setOrgStatus(org,status){demo.orgs.find(o=>o.id===org).status=status;}
};

export const store=live?supabaseStore:demoStore;
