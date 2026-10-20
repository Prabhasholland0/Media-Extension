import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const files=['001_schema.sql','camera-count.sql','003_harden_performance.sql','camera-not-needed.sql','campuses.sql','permanent-delete.sql','phone-signin.sql','004_platform.sql','005_phase1_stabilize.sql','006_tenant_core.sql'];
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
// 1 owner A, 2 scheduler A, 3 member/leader A, 4 member A, 5 owner B, 6 invitee (confirmed), 7 unconfirmed, 9 platform admin
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated;`);
 for(const f of files)await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
 for(const n of [1,2,3,4,5,6,7,9])await db.query(`insert into auth.users values($1,$2,'{"app":"mediahub-platform","full_name":"User"}',$3)`,[id(n),`user${n}@example.com`,n===7?null:new Date().toISOString()]);
 await db.exec('set role authenticated');
 const as=u=>db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[u]);
 const q=async(sql,args)=>(await db.query(sql,args)).rows;
 const one=async(sql,args)=>(await q(sql,args))[0];
 await as(id(1));const A=(await one(`select public.create_organization('Church A','church') id`)).id;
 const code=(await one(`select public.org_invite_code($1) c`,[A])).c;
 for(const n of [2,3,4]){await as(id(n));await db.query(`select public.join_organization($1)`,[code]);}
 await as(id(5));const B=(await one(`select public.create_organization('Church B','media') id`)).id;
 await as(id(1));await db.query(`select public.set_member_role($1,$2,'scheduler')`,[A,id(2)]);
 return {db,as,q,one,A,B};
}

test('roles grant named permissions and cannot be used to escalate',async()=>{
 const {db,as,q,one,A}=await setup();
 await as(id(1));
 assert.equal((await q(`select key from public.org_roles where org_id=$1 order by key`,[A])).map(r=>r.key).join(),'admin,member,owner,scheduler');
 await as(id(2));
 assert.deepEqual((await one(`select public.my_permissions($1) p`,[A])).p.sort(),['events.manage','members.contact.read','schedule.manage']);
 const ev=(await one(`insert into public.events(org_id,title,event_date) values($1,'Sunday','2026-11-01') returning id`,[A])).id;
 assert.ok(ev,'scheduler manages events');
 await assert.rejects(()=>db.query(`insert into public.teams(org_id,name) values($1,'Nope')`,[A]),/row-level security/,'scheduler cannot edit departments');
 await assert.rejects(()=>db.query(`select public.set_member_role($1,$2,'admin')`,[A,id(4)]),/permission to manage people/);
 await assert.rejects(()=>db.query(`update public.organizations set name='Hacked' where id=$1`,[A]).then(r=>{if(!r.affectedRows)throw Error('row-level security: no rows');}),/row-level security/);
 // A people manager without other powers cannot hand out admin or widen their own role.
 await as(id(1));
 await db.query(`select public.save_role($1,'greeter_lead','Greeter lead',array['members.manage'])`,[A]);
 await db.query(`select public.set_member_role($1,$2,'greeter_lead')`,[A,id(3)]);
 await as(id(3));
 await assert.rejects(()=>db.query(`select public.set_member_role($1,$2,'admin')`,[A,id(4)]),/permissions you do not have/);
 await assert.rejects(()=>db.query(`select public.save_role($1,'greeter_lead','Greeter lead',array['members.manage','org.manage'])`,[A]),/permission to manage roles/,'needs roles.manage to touch roles at all');
 await assert.rejects(()=>db.query(`select public.invite_member($1,'x@example.com','admin')`,[A]),/permissions you do not have/);
 await assert.rejects(()=>db.query(`select public.remove_member($1,$2)`,[A,id(2)]),/permissions you do not have/,'cannot remove a scheduler with wider rights');
 await assert.rejects(()=>db.query(`select public.set_member_role($1,$2,'member')`,[A,id(3)]),/own role/);
 await assert.rejects(()=>db.query(`select public.save_role($1,'owner','Boss','{}')`,[A]),/permission to manage roles|owner role/);
 await as(id(1));
 await db.query(`select public.save_role($1,'people_lead','People lead',array['members.manage','roles.manage'])`,[A]);
 await db.query(`select public.set_member_role($1,$2,'people_lead')`,[A,id(4)]);
 await as(id(4));
 await assert.rejects(()=>db.query(`select public.save_role($1,'people_lead','People lead',array['members.manage','roles.manage','org.manage'])`,[A]),/permissions you do not have/,'role managers cannot widen their own role');
 await assert.rejects(()=>db.query(`select public.save_role($1,'scheduler','Scheduler','{}')`,[A]),/role with permissions you do not have/,'or edit a role wider than theirs');
 await db.query(`select public.save_role($1,'helpers','Helpers',array['members.manage'])`,[A]);
 await as(id(1));
 await assert.rejects(()=>db.query(`select public.delete_role($1,'greeter_lead')`,[A]),/Move everyone/);
 await assert.rejects(()=>db.query(`select public.delete_role($1,'admin')`,[A]),/Built-in/);
 await assert.rejects(()=>db.query(`insert into public.org_roles(org_id,key,name) values($1,'x','X')`,[A]),/permission denied/);
 // Ownership transfer.
 await db.query(`select public.transfer_ownership($1,$2)`,[A,id(2)]);
 assert.equal((await one(`select role from public.org_members where org_id=$1 and user_id=$2`,[A,id(1)])).role,'admin');
 await assert.rejects(()=>db.query(`select public.transfer_ownership($1,$2)`,[A,id(1)]),/Only the owner/);
 await db.close();
});

test('organization B can read or change nothing in organization A',async()=>{
 const {db,as,q,one,A,B}=await setup();
 await as(id(1));
 const camp=(await one(`insert into public.campuses(org_id,name) values($1,'Main') returning id`,[A])).id;
 const team=(await one(`select id from public.teams where org_id=$1 limit 1`,[A])).id;
 await db.query(`insert into public.department_members(org_id,team_id,user_id,dept_role) values($1,$2,$3,'leader')`,[A,team,id(3)]);
 await db.query(`select public.invite_member($1,'user6@example.com','member')`,[A]);
 await db.query(`insert into public.events(org_id,title,event_date,campus_id) values($1,'A event','2026-11-01',$2)`,[A,camp]);
 await as(id(5));
 for(const t of ['org_members','org_roles','campuses','teams','positions','department_members','invitations','audit_log','events','member_positions'])
  assert.equal((await q(`select * from public.${t} where org_id=$1`,[A])).length,0,`B sees nothing in ${t}`);
 assert.equal((await q(`select id from public.organizations where id=$1`,[A])).length,0);
 assert.equal((await q(`select * from public.org_roster($1)`,[A])).length,0);
 assert.deepEqual((await one(`select public.my_permissions($1) p`,[A])).p,[]);
 await assert.rejects(()=>db.query(`insert into public.campuses(org_id,name) values($1,'Spy')`,[A]),/row-level security/);
 await assert.rejects(()=>db.query(`insert into public.events(org_id,title,event_date,campus_id) values($1,'Cross','2026-11-01',$2)`,[B,camp]),/foreign key/,'cannot point at another church campus');
 await assert.rejects(()=>db.query(`select public.invite_member($1,'a@example.com','member')`,[A]),/permission to invite/);
 await assert.rejects(()=>db.query(`select public.save_role($1,'x','X','{}')`,[A]),/permission to manage roles/);
 await assert.rejects(()=>db.query(`select public.transfer_ownership($1,$2)`,[A,id(5)]),/Only the owner/);
 assert.equal((await q(`select * from public.platform_organizations()`)).length,0,'non-operators see no platform list');
 await db.close();
});

test('department leaders schedule only their own department',async()=>{
 const {db,as,q,one,A}=await setup();
 await as(id(1));
 const media=(await one(`select id from public.teams where org_id=$1 and name='Media'`,[A])).id;
 const cam=(await one(`select id from public.positions where org_id=$1 and name='Camera'`,[A])).id;
 const keys=(await one(`select id from public.positions where org_id=$1 and name='Keys'`,[A])).id;
 await db.query(`insert into public.department_members(org_id,team_id,user_id,dept_role) values($1,$2,$3,'leader')`,[A,media,id(3)]);
 const ev=(await one(`insert into public.events(org_id,title,event_date) values($1,'Sunday','2026-11-01') returning id`,[A])).id;
 const svc=(await one(`insert into public.event_services(org_id,event_id,name) values($1,$2,'9 AM') returning id`,[A,ev])).id;
 await db.query(`insert into public.event_needs(org_id,event_id,position_id,quantity) values($1,$2,$3,1),($1,$2,$4,1)`,[A,ev,cam,keys]);
 await db.query(`select public.save_service_assignments($1,$2)`,[svc,JSON.stringify([{position_id:keys,slot:1,user_id:id(2)}])]);
 await as(id(3));
 assert.equal((await q(`select * from public.events`)).length,1,'leaders see drafts to plan');
 await db.query(`select public.save_service_assignments($1,$2)`,[svc,JSON.stringify([{position_id:cam,slot:1,user_id:id(4)},{position_id:keys,slot:1,user_id:id(3)}])]);
 const rows=await q(`select position_id,user_id from public.plan_assignments order by position_id=$1 desc`,[cam]);
 assert.deepEqual(rows.map(r=>r.user_id),[id(4),id(2)],'own seat changed, other department untouched');
 await assert.rejects(()=>db.query(`select public.save_service_assignments($1,$2)`,[svc,JSON.stringify([{position_id:cam,slot:1,user_id:id(2)}])]),/one position per service/,'cannot double-book someone from another department');
 await as(id(4));
 await assert.rejects(()=>db.query(`select public.save_service_assignments($1,$2)`,[svc,'[]']),/permission to schedule/);
 assert.equal((await q(`select * from public.events`)).length,0,'plain members do not see drafts');
 await db.close();
});

test('email invitations need a confirmed matching address and are not duplicated',async()=>{
 const {db,as,q,one,A}=await setup();
 await as(id(1));
 const first=(await one(`select public.invite_member($1,'User6@Example.com','scheduler') i`,[A])).i;
 const again=(await one(`select public.invite_member($1,'user6@example.com','member') i`,[A])).i;
 assert.equal(first,again,'repeat invite reuses the open one');
 assert.equal((await q(`select role from public.invitations where org_id=$1`,[A]))[0].role,'member');
 await assert.rejects(()=>db.query(`select public.invite_member($1,'user2@example.com','member')`,[A]),/already a member/);
 await db.query(`select public.invite_member($1,'user7@example.com','member')`,[A]);
 await as(id(7));
 assert.equal((await q(`select * from public.my_invitations()`)).length,0,'unconfirmed email sees nothing');
 await as(id(4));
 await assert.rejects(()=>db.query(`select public.answer_invitation($1,true)`,[first]),/not found/,'someone else cannot accept');
 await as(id(6));
 const mine=await q(`select * from public.my_invitations()`);
 assert.equal(mine.length,1);assert.equal(mine[0].org_name,'Church A');
 assert.equal((await one(`select public.answer_invitation($1,true) o`,[first])).o,A);
 assert.equal((await one(`select role from public.org_members where org_id=$1 and user_id=$2`,[A,id(6)])).role,'member');
 await assert.rejects(()=>db.query(`select public.answer_invitation($1,true)`,[first]),/not found/,'invitations work once');
 await db.close();
});

test('activity log, suspension, time zones and platform operators',async()=>{
 const {db,as,q,one,A,B}=await setup();
 await as(id(1));
 await db.query(`update public.organizations set time_zone='America/Chicago',contact_email='office@a.example' where id=$1`,[A]);
 await assert.rejects(()=>db.query(`update public.organizations set time_zone='Mars/Base' where id=$1`,[A]),/Unknown time zone/);
 await db.query(`select public.set_member_role($1,$2,'member')`,[A,id(2)]);
 const log=await q(`select action,entity,detail,actor_id from public.audit_log where org_id=$1 order by id`,[A]);
 assert.ok(log.some(l=>l.entity==='org_members'&&l.action==='update'&&l.detail.role==='member'&&l.actor_id===id(1)),'role change logged with actor');
 assert.ok(log.some(l=>l.entity==='organizations'&&l.detail.time_zone==='America/Chicago'));
 assert.ok(!log.some(l=>JSON.stringify(l.detail).includes('join_code')),'invite code never logged');
 await assert.rejects(()=>db.query(`delete from public.audit_log`),/permission denied/);
 await assert.rejects(()=>db.query(`update public.audit_log set action='x'`),/permission denied/);
 await as(id(4));assert.equal((await q(`select * from public.audit_log`)).length,0,'members cannot read the log');
 // Platform operator: metadata only.
 await db.exec('reset role');await db.query(`insert into public.platform_admins values($1)`,[id(9)]);await db.exec('set role authenticated');
 await as(id(9));
 const orgs=await q(`select * from public.platform_organizations()`);
 assert.equal(orgs.length,2);assert.equal(Number(orgs.find(o=>o.id===A).members),4);
 assert.equal((await q(`select * from public.events`)).length+(await q(`select * from public.org_members`)).length,0,'no church records');
 await db.query(`select public.set_organization_status($1,'suspended')`,[B]);
 await as(id(5));
 assert.equal((await q(`select name from public.organizations`))[0].name,'Church B','suspended church can still read');
 await assert.rejects(()=>db.query(`insert into public.events(org_id,title,event_date) values($1,'X','2026-11-01')`,[B]),/row-level security/,'but cannot write');
 await assert.rejects(()=>db.query(`select public.set_organization_status($1,'active')`,[B]),/Platform administrator/);
 await db.close();
});
