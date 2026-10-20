import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('organizations are isolated and only admins plan or schedule',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated;`);
 await db.exec(await readFile(new URL('../supabase/001_schema.sql',import.meta.url),'utf8'));
 for(const f of ['004_platform.sql','005_phase1_stabilize.sql','006_tenant_core.sql','007_scheduling.sql','008_availability.sql'])await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
 for(let i=1;i<=6;i++)await db.query(`insert into auth.users values($1,$2,$3)`,[id(i),`user${i}@example.com`,JSON.stringify({full_name:`User ${i}`})]);
 await db.query(`update public.profiles set phone='555'`);
 await db.exec('set role authenticated');
 const as=u=>db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[u]);
 const one=async(sql,args)=>(await db.query(sql,args)).rows[0];
 const rows=async(sql,args)=>(await db.query(sql,args)).rows;

 // Two independent organizations.
 await as(id(1));
 const org=(await one(`select public.create_organization('Grace Media','media') id`)).id;
 const code=(await one(`select public.org_invite_code($1) c`,[org])).c;
 assert.equal((await rows(`select * from public.positions where org_id=$1`,[org])).length,8,'media preset seeds positions');
 await as(id(5));
 const other=(await one(`select public.create_organization('Other Church','blank') id`)).id;
 await db.query(`insert into public.teams(org_id,name) values($1,'Secret')`,[other]);
 assert.equal((await one(`select public.join_organization('NOPE1234') id`)).id,null,'unknown codes join nothing');

 for(const u of [2,3,4]){await as(id(u));await db.query(`select public.join_organization($1)`,[code.toLowerCase()]);}
 await as(id(2));
 assert.equal((await rows(`select id,name from public.organizations`)).length,1,'members see only their organizations');
 assert.equal((await rows(`select * from public.teams where org_id=$1`,[other])).length,0);
 assert.equal((await rows(`select * from public.org_roster($1)`,[other])).length,0);
 const roster=await rows(`select * from public.org_roster($1)`,[org]);
 assert.equal(roster.length,4);
 assert.equal(roster.find(r=>r.user_id===id(3)).email,'','members cannot read co-member contact details');
 await assert.rejects(()=>db.query(`insert into public.events(org_id,title,event_date) values($1,'Hack','2026-11-01')`,[org]),/row-level security/);
 await assert.rejects(()=>db.query(`select public.set_member_role($1,$2,'admin')`,[org,id(2)]),/permission to manage people|Admin access/);
 await assert.rejects(()=>db.query(`update public.org_members set role='owner'`),/permission denied/);

 // Admin builds an event with two services, needs and a plan.
 await as(id(1));
 await db.query(`select public.set_member_role($1,$2,'admin')`,[org,id(2)]);
 await assert.rejects(()=>db.query(`select public.remove_member($1,$2)`,[org,id(1)]),/owner cannot be removed/);
 await as(id(2));
 const ev=(await one(`insert into public.events(org_id,title,event_date) values($1,'Sunday','2026-11-01') returning id`,[org])).id;
 const svc=(await rows(`insert into public.event_services(org_id,event_id,name,sort_order) values($1,$2,'9 AM',1),($1,$2,'11 AM',2) returning id`,[org,ev])).map(r=>r.id);
 const cam=(await one(`select id from public.positions where org_id=$1 and name='Camera'`,[org])).id;
 const prod=(await one(`select id from public.positions where org_id=$1 and name='Producer'`,[org])).id;
 await db.query(`insert into public.event_needs(org_id,event_id,position_id,quantity) values($1,$2,$3,2),($1,$2,$4,1)`,[org,ev,cam,prod]);
 await db.query(`insert into public.plan_items(org_id,event_id,title,kind,duration_minutes) values($1,$2,'Welcome','item',5)`,[org,ev]);
 const otherPos=(await as(id(5)),await one(`insert into public.positions(org_id,team_id,name) select org_id,id,'Spy' from public.teams where org_id=$1 returning id`,[other])).id;
 await as(id(2));
 await assert.rejects(()=>db.query(`insert into public.event_needs(org_id,event_id,position_id,quantity) values($1,$2,$3,1)`,[org,ev,otherPos]),/foreign key/,'cannot use another organization position');

 const save=(s,list)=>db.query(`select public.save_service_assignments($1,$2)`,[s,JSON.stringify(list)]);
 await assert.rejects(()=>save(svc[0],[{position_id:cam,slot:3,user_id:id(3)}]),/outside the positions/);
 await assert.rejects(()=>save(svc[0],[{position_id:cam,slot:1,user_id:id(5)}]),/Only members/);
 await assert.rejects(()=>save(svc[0],[{position_id:cam,slot:1,user_id:id(3)},{position_id:prod,slot:1,user_id:id(3)}]),/one position per service/);
 await save(svc[0],[{position_id:cam,slot:1,user_id:id(3)},{position_id:cam,slot:2,user_id:id(4)},{position_id:prod,slot:1,user_id:id(1)}]);
 assert.equal((await rows(`select * from public.plan_assignments`)).length,3);

 // Members see drafts only after publishing, and answer only their own requests.
 await as(id(3));
 assert.equal((await rows(`select * from public.events`)).length,0,'draft hidden');
 const mine=await rows(`select * from public.plan_assignments`);
 assert.equal(mine.length,1,'own request visible even before publishing');
 await as(id(2));
 await db.query(`update public.events set status='published' where id=$1`,[ev]);
 await as(id(3));
 assert.equal((await rows(`select * from public.event_services`)).length,2);
 assert.equal((await rows(`select * from public.plan_items`)).length,1);
 await db.query(`select public.respond_assignment($1,'declined')`,[mine[0].id]);
 const theirs=(await one(`select id from public.plan_assignments where user_id=$1`,[id(4)])).id;
 await assert.rejects(()=>db.query(`select public.respond_assignment($1,'declined')`,[theirs]),/not found/);
 await as(id(4));await db.query(`select public.respond_assignment($1,'accepted')`,[theirs]);

 // Re-saving keeps unchanged responses; lowering needs trims extra slots.
 await as(id(2));
 await save(svc[0],[{position_id:cam,slot:2,user_id:id(4)},{position_id:cam,slot:1,user_id:id(2)},{position_id:prod,slot:1,user_id:id(1)}]);
 assert.equal((await one(`select status from public.plan_assignments where user_id=$1`,[id(4)])).status,'accepted');
 assert.equal((await one(`select status from public.plan_assignments where user_id=$1`,[id(2)])).status,'pending');
 await db.query(`update public.event_needs set quantity=1 where event_id=$1 and position_id=$2`,[ev,cam]);
 assert.equal((await rows(`select * from public.plan_assignments where position_id=$1`,[cam])).length,1);
 const copy=(await one(`select public.duplicate_event($1,'2026-11-08') id`,[ev])).id;
 assert.equal((await rows(`select * from public.event_services where event_id=$1`,[copy])).length,2);
 assert.equal((await one(`select status from public.events where id=$1`,[copy])).status,'draft');

 // Blockouts are private to the member and their organization admins.
 await as(id(3));await db.query(`insert into public.blockouts(user_id,day) values($1,'2026-11-08')`,[id(3)]);
 await assert.rejects(()=>db.query(`insert into public.blockouts(user_id,day) values($1,'2026-11-08')`,[id(4)]),/row-level security/);
 await as(id(4));assert.equal((await rows(`select * from public.blockouts`)).length,0);
 await as(id(2));assert.equal((await rows(`select * from public.blockouts`)).length,1);
 await as(id(5));assert.equal((await rows(`select * from public.blockouts`)).length,0);

 // Leaving removes access and the member's assignments.
 await as(id(4));await db.query(`select public.remove_member($1,$2)`,[org,id(4)]);
 assert.equal((await rows(`select * from public.events`)).length,0);
 await as(id(2));assert.equal((await rows(`select * from public.plan_assignments where user_id=$1`,[id(4)])).length,0);
 await as(id(1));await db.query(`delete from public.organizations where id=$1`,[org]);
 assert.equal((await rows(`select * from public.events`)).length,0);
});
