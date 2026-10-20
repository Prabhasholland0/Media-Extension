import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const files=['001_schema.sql','camera-count.sql','003_harden_performance.sql','camera-not-needed.sql','campuses.sql','permanent-delete.sql','phone-signin.sql','004_platform.sql','005_phase1_stabilize.sql','006_tenant_core.sql','007_scheduling.sql','008_availability.sql','009_nlag_import.sql'];
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

const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
async function plan(ctx){
 const {db,as,one,A}=ctx;
 await as(id(1));
 const cam=(await one(`select id from public.positions where org_id=$1 and name='Camera'`,[A])).id;
 for(const n of [2,3,4])await db.query(`insert into public.member_positions(org_id,user_id,position_id) values($1,$2,$3)`,[A,id(n),cam]);
 const ev=(await one(`select public.create_event($1,$2) id`,[A,JSON.stringify({title:'Sunday',event_date:day(7),services:[{name:'9 AM',starts_at:'09:00'},{name:'11 AM'}],needs:[{position_id:cam,quantity:2}]})])).id;
 const svc=(await one(`select id from public.event_services where event_id=$1 and sort_order=1`,[ev])).id;
 return {cam,ev,svc};
}
const inbox=async(ctx,n)=>{await ctx.as(id(n));return (await ctx.q(`select kind,title,body from public.notifications order by created_at,kind`)).map(r=>r.kind);};

test('create_event is one transaction and checks permission and tenant',async()=>{
 const ctx=await setup();const {db,as,q,one,A,B}=ctx;
 const {cam,ev}=await plan(ctx);
 assert.equal((await q(`select name,starts_at from public.event_services where event_id=$1 order by sort_order`,[ev])).map(s=>s.name).join(),'9 AM,11 AM');
 assert.equal((await one(`select quantity from public.event_needs where event_id=$1`,[ev])).quantity,2);
 const before=(await one(`select count(*)::int n from public.events`)).n;
 await assert.rejects(()=>db.query(`select public.create_event($1,$2)`,[A,JSON.stringify({title:'Bad',event_date:day(8),services:[{name:'x'}],needs:[{position_id:id(999),quantity:1}]})]),/foreign key/);
 assert.equal((await one(`select count(*)::int n from public.events`)).n,before,'nothing left behind when a need is invalid');
 await as(id(5));
 await assert.rejects(()=>db.query(`select public.create_event($1,$2)`,[A,JSON.stringify({title:'Spy',event_date:day(8)})]),/permission to manage events/);
 await assert.rejects(()=>db.query(`select public.create_event($1,$2)`,[B,JSON.stringify({title:'Cross',event_date:day(8),needs:[{position_id:cam,quantity:1}]})]),/foreign key/,'cannot use another church position');
 await as(id(4));
 await assert.rejects(()=>db.query(`select public.create_event($1,$2)`,[A,JSON.stringify({title:'Nope',event_date:day(8)})]),/permission to manage events/);
 await db.close();
});

test('service types create weekly events once per date',async()=>{
 const ctx=await setup();const {db,as,q,one,A}=ctx;
 await as(id(1));
 const cam=(await one(`select id from public.positions where org_id=$1 and name='Camera'`,[A])).id;
 const t=(await one(`insert into public.service_types(org_id,name,weekday,services,needs) values($1,'Sunday Service',0,$2,$3) returning id`,
  [A,JSON.stringify([{name:'First',starts_at:'09:00'}]),JSON.stringify([{position_id:cam,quantity:3},{position_id:id(999),quantity:1}])])).id;
 assert.equal((await one(`select public.create_events_from_type($1,$2,4) n`,[t,day(1)])).n,4);
 assert.equal((await one(`select public.create_events_from_type($1,$2,6) n`,[t,day(1)])).n,2,'existing dates are skipped');
 const evs=await q(`select event_date,extract(dow from event_date)::int dow,status from public.events where service_type_id=$1 order by event_date`,[t]);
 assert.equal(evs.length,6);assert.ok(evs.every(e=>e.dow===0&&e.status==='draft'),'all on Sundays, as drafts');
 assert.equal((await one(`select count(*)::int n from public.event_needs n join public.events e on e.id=n.event_id where e.service_type_id=$1`,[t])).n,6,'deleted positions are skipped');
 await assert.rejects(()=>db.query(`select public.create_events_from_type($1,$2,40)`,[t,day(1)]),/between 1 and 26/);
 await as(id(4));
 assert.equal((await q(`select * from public.service_types`)).length,1,'members can read service types');
 await assert.rejects(()=>db.query(`select public.create_events_from_type($1,$2,1)`,[t,day(1)]),/permission/);
 await assert.rejects(()=>db.query(`insert into public.service_types(org_id,name) values($1,'X')`,[A]),/row-level security/);
 await as(id(5));
 assert.equal((await q(`select * from public.service_types`)).length,0,'other churches see none');
 await db.close();
});

test('people are notified when scheduled, on decline and on cancellation',async()=>{
 const ctx=await setup();const {db,as,q,one}=ctx;
 const {cam,ev,svc}=await plan(ctx);
 await db.query(`select public.save_service_assignments($1,$2)`,[svc,JSON.stringify([{position_id:cam,slot:1,user_id:id(3)},{position_id:cam,slot:2,user_id:id(4)}])]);
 assert.deepEqual(await inbox(ctx,3),[],'drafts notify nobody');
 await as(id(1));await db.query(`update public.events set status='published' where id=$1`,[ev]);
 assert.deepEqual(await inbox(ctx,3),['scheduled']);
 assert.match((await one(`select body from public.notifications`)).body,/Camera · Sunday/);
 await as(id(4));await db.query(`select public.respond_assignment(id,'declined') from public.plan_assignments where user_id=$1`,[id(4)]);
 assert.deepEqual(await inbox(ctx,1),['declined'],'owner hears about the decline');
 assert.deepEqual(await inbox(ctx,2),['declined'],'scheduler too');
 assert.deepEqual(await inbox(ctx,4),['scheduled'],'not about their own decline');
 await as(id(3));assert.equal((await q(`select * from public.notifications where user_id<>$1`,[id(3)])).length,0,'only your own');
 await db.query(`select public.mark_notifications_read(null)`);
 assert.equal((await one(`select count(*)::int n from public.notifications where read_at is null`)).n,0);
 await assert.rejects(()=>db.query(`insert into public.notifications(user_id,org_id,kind,title) values($1,$2,'scheduled','x')`,[id(4),ctx.A]),/permission denied/);
 await assert.rejects(()=>db.query(`select public.notify(array[$1]::uuid[],$2,'scheduled','x','',null)`,[id(4),ctx.A]),/permission denied/);
 await as(id(1));await db.query(`update public.events set status='cancelled' where id=$1`,[ev]);
 assert.deepEqual(await inbox(ctx,3),['scheduled','cancelled']);
 assert.deepEqual(await inbox(ctx,4),['scheduled'],'people who declined are not told');
 await as(id(3));
 await assert.rejects(()=>db.query(`select public.respond_assignment(id,'accepted') from public.plan_assignments where user_id=$1`,[id(3)]),/cancelled/);
 assert.equal((await q(`select status from public.events`))[0].status,'cancelled','members still see the cancelled event');
 // Leaving clears that church's notifications.
 await db.query(`select public.remove_member($1,$2)`,[ctx.A,id(3)]);
 assert.equal((await q(`select * from public.notifications`)).length,0);
 await db.close();
});

test('a trained, free member can take a spot someone asked to hand over',async()=>{
 const ctx=await setup();const {db,as,q,one,A}=ctx;
 const {cam,ev,svc}=await plan(ctx);
 const svc2=(await one(`select id from public.event_services where event_id=$1 and sort_order=2`,[ev])).id;
 await db.query(`select public.save_service_assignments($1,$2)`,[svc,JSON.stringify([{position_id:cam,slot:1,user_id:id(3)}])]);
 await db.query(`select public.save_service_assignments($1,$2)`,[svc2,JSON.stringify([{position_id:cam,slot:1,user_id:id(4)}])]);
 await db.query(`update public.events set status='published' where id=$1`,[ev]);
 await as(id(3));
 const a=(await one(`select id from public.plan_assignments where user_id=$1`,[id(3)])).id;
 await db.query(`select public.request_replacement($1,'Family visit')`,[a]);
 assert.ok((await inbox(ctx,4)).includes('replacement_requested'),'a trained member who is free hears about it');
 assert.ok((await inbox(ctx,2)).includes('replacement_requested'),'scheduler hears about it');
 await as(id(5));
 await assert.rejects(()=>db.query(`select public.take_replacement($1)`,[a]),/no longer open|not set up/,'another church cannot take it');
 await as(id(1));
 await assert.rejects(()=>db.query(`select public.take_replacement($1)`,[a]),/not set up for this position/);
 await as(id(4));
 await db.query(`select public.take_replacement($1)`,[a]);
 const row=await one(`select user_id,status,replacement_requested_at from public.plan_assignments where id=$1`,[a]);
 assert.equal(row.user_id,id(4));assert.equal(row.status,'accepted');assert.equal(row.replacement_requested_at,null);
 assert.ok((await inbox(ctx,3)).includes('replacement_taken'),'original person is told');
 await as(id(2));
 await assert.rejects(()=>db.query(`select public.take_replacement($1)`,[a]),/no longer open/,'only once');
 // Someone already serving in that service cannot take a second seat in it.
 await as(id(4));await db.query(`select public.request_replacement($1,'')`,[a]);
 await db.query(`select public.respond_assignment($1,'accepted')`,[a]);
 assert.equal((await one(`select replacement_requested_at from public.plan_assignments where id=$1`,[a])).replacement_requested_at,null,'accepting again withdraws the request');
 await db.query(`select public.request_replacement($1,'')`,[a]);await db.query(`select public.cancel_replacement($1)`,[a]);
 await as(id(3));
 await assert.rejects(()=>db.query(`select public.request_replacement($1,'')`,[a]),/Assignment not found/,'only the person in the spot can hand it over');
 await db.close();
});

test('members answer availability per service without seeing draft rosters',async()=>{
 const ctx=await setup();const {db,as,q,one,A}=ctx;
 const {cam,ev,svc}=await plan(ctx);
 await db.query(`select public.save_service_assignments($1,$2)`,[svc,JSON.stringify([{position_id:cam,slot:1,user_id:id(3)}])]);
 await as(id(4));
 assert.equal((await q(`select * from public.availability_requests($1)`,[A])).length,0,'nothing until availability is open');
 await assert.rejects(()=>db.query(`select public.set_availability($1,'available')`,[svc]),/not asking for availability/);
 await as(id(1));await db.query(`update public.events set availability_open=true where id=$1`,[ev]);
 assert.deepEqual(await inbox(ctx,4),['availability'],'trained members are asked');
 assert.deepEqual(await inbox(ctx,1),[],'not the person who opened it');
 await as(id(4));
 const req=await q(`select * from public.availability_requests($1)`,[A]);
 assert.equal(req.length,2,'both services of the draft');assert.equal(req[0].status,null,'missing answer means not answered');
 await db.query(`select public.set_availability($1,'not_available')`,[svc]);
 await db.query(`select public.set_availability($1,'available')`,[svc]);
 assert.equal((await q(`select status from public.availability_requests($1) where service_id=$2`,[A,svc]))[0].status,'available');
 assert.equal((await q(`select * from public.events`)).length,0,'the draft itself stays hidden');
 assert.equal((await q(`select * from public.plan_assignments`)).length,0,'and so does its roster');
 await as(id(3));await db.query(`select public.set_availability($1,'not_available')`,[svc]);
 assert.equal((await q(`select * from public.service_availability`)).length,1,'members see only their own answers');
 await as(id(2));
 assert.equal((await q(`select * from public.service_availability`)).length,2,'schedulers see everyone');
 await as(id(5));
 assert.equal((await q(`select * from public.availability_requests($1)`,[A])).length,0,'other churches see nothing');
 await assert.rejects(()=>db.query(`select public.set_availability($1,'available')`,[svc]),/Service not found/);
 await assert.rejects(()=>db.query(`insert into public.service_availability(org_id,service_id,user_id,status) values($1,$2,$3,'available')`,[A,svc,id(5)]),/permission denied/);
 // Service types can open availability on every event they create.
 await as(id(1));
 const t=(await one(`insert into public.service_types(org_id,name,weekday,ask_availability,needs) values($1,'Midweek',3,true,$2) returning id`,[A,JSON.stringify([{position_id:cam,quantity:1}])])).id;
 await db.query(`select public.create_events_from_type($1,$2,2)`,[t,day(1)]);
 assert.equal((await one(`select count(*)::int n from public.events where service_type_id=$1 and availability_open`,[t])).n,2);
 assert.equal((await inbox(ctx,4)).filter(k=>k==='availability').length,3);
 await db.close();
});
