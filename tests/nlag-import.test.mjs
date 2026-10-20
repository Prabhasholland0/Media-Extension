import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migrationOrder} from './migrations.mjs';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};

// NLAG data as the live app stores it: 1 admin, 2-4 volunteers, 5 inactive, 6 a platform-only sign-up.
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated;`);
 for(const f of migrationOrder)await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
 for(const n of [1,2,3,4,5])await db.query(`insert into auth.users values($1,$2,$3,now())`,[id(n),`nlag${n}@example.com`,JSON.stringify({full_name:`Volunteer ${n}`})]);
 await db.query(`insert into auth.users values($1,'other@example.com','{"full_name":"Other","app":"mediahub-platform"}',now())`,[id(6)]);
 await db.query(`update public.profiles set is_admin=(id=$1),skills=case id when $1 then array['producer','camera'] when $2 then array['ccu'] when $3 then array['camera'] when $4 then array['camera','ccu'] else array['camera'] end,active=(id<>$5)`,[id(1),id(2),id(3),id(4),id(5)]);
 const past=day(-7),next=day(7);
 // Past published Sunday: 4 cameras, cam_2 not needed. Future draft Sunday with answers only.
 const s=(await db.query(`insert into public.schedules(service_date,service_id,status,camera_count,not_needed_cameras) values($1,'first','published',4,'{cam_2}') returning id`,[past])).rows[0].id;
 await db.query(`insert into public.assignments(schedule_id,position,user_id) values($1,'producer',$2),($1,'ccu',$3),($1,'cam_3',$4),($1,'cam_4',$5),($1,'cam_1',$6)`,[s,id(1),id(2),id(3),id(4),id(5)]);
 await db.query(`insert into public.availability(user_id,service_date,service_id,status) values($1,$3,'first','available'),($2,$3,'first','not_available'),($1,$3,'eden_english','available')`,[id(3),id(4),next]);
 return {db,s,past,next};
}

test('NLAG imports into one organization with exact seats, and re-running adds only what is new',async()=>{
 const {db,past,next}=await setup();
 await assert.rejects(()=>db.query(`select * from platform_private.import_nlag($1,'NLAG')`,[id(6)]),/active NLAG admin/,'platform users cannot be the owner');
 const report=(await db.query(`select * from platform_private.import_nlag($1,'New Life Assembly of God')`,[id(1)])).rows;
 const r=Object.fromEntries(report.map(x=>[x.item,[Number(x.nlag),Number(x.platform)]]));
 assert.deepEqual(r['Active members'],[4,4]);assert.deepEqual(r['Skills'],[6,6]);assert.deepEqual(r['Service dates'],[3,3]);
 assert.deepEqual(r['Assignments'],[5,4],'inactive volunteer 5 is not copied');assert.deepEqual(r['Availability answers'],[3,3]);
 const org=(await db.query(`select id,name,time_zone from public.organizations`)).rows[0];
 assert.equal(org.name,'New Life Assembly of God');assert.equal(org.time_zone,'Asia/Kolkata');
 assert.deepEqual((await db.query(`select user_id,role from public.org_members order by user_id`)).rows.map(m=>m.role),['owner','member','member','member']);
 assert.deepEqual((await db.query(`select name from public.campuses order by sort_order`)).rows.map(c=>c.name),['Kompally','Eden Square']);
 // The past Sunday keeps 3 cameras (cam_2 not needed), and cam_3/cam_4 become Camera 2 and 3.
 const ev=(await db.query(`select e.id,e.status,c.name campus from public.events e join public.campuses c on c.id=e.campus_id where e.event_date=$1`,[past])).rows[0];
 assert.equal(ev.status,'published');assert.equal(ev.campus,'Kompally');
 assert.equal((await db.query(`select n.quantity from public.event_needs n join public.positions p on p.id=n.position_id where n.event_id=$1 and p.name='Camera'`,[ev.id])).rows[0].quantity,3);
 const seats=(await db.query(`select p.name,a.slot,a.user_id,a.status from public.plan_assignments a join public.positions p on p.id=a.position_id join public.event_services s on s.id=a.service_id where s.event_id=$1 order by p.sort_order,a.slot`,[ev.id])).rows;
 assert.deepEqual(seats.map(x=>`${x.name}${x.slot}:${x.user_id.slice(-1)}:${x.status}`),['Producer1:1:accepted','CCU1:2:accepted','Camera2:3:accepted','Camera3:4:accepted']);
 // Future dates people answered become draft events open for availability, one per service.
 const future=(await db.query(`select e.title,e.status,e.availability_open,c.name campus from public.events e join public.campuses c on c.id=e.campus_id where e.event_date=$1 order by c.name`,[next])).rows;
 assert.deepEqual(future.map(f=>`${f.campus}:${f.title}:${f.status}:${f.availability_open}`),['Eden Square:English:draft:true','Kompally:1st Service:draft:true']);
 assert.equal((await db.query(`select count(*)::int n from public.notifications`)).rows[0].n,0,'the import notifies nobody');
 // NLAG is untouched.
 assert.equal((await db.query(`select count(*)::int n from public.assignments`)).rows[0].n,5);
 // Re-run: nothing duplicated; a new NLAG member and date are added.
 await db.query(`insert into auth.users values($1,'late@example.com','{"full_name":"Late"}',now())`,[id(7)]);
 await db.query(`insert into public.schedules(service_date,service_id) values($1,'hindi')`,[day(14)]);
 const again=Object.fromEntries((await db.query(`select * from platform_private.import_nlag($1,'ignored')`,[id(1)])).rows.map(x=>[x.item,Number(x.platform)]));
 assert.equal(again['Active members'],5);assert.equal(again['Service dates'],4);assert.equal(again['Assignments'],4);
 assert.equal((await db.query(`select count(*)::int n from public.organizations`)).rows[0].n,1);
 // Clients cannot run the import.
 await db.exec('set role authenticated');
 await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id(1)]);
 await assert.rejects(()=>db.query(`select * from platform_private.import_nlag($1,'x')`,[id(1)]),/permission denied/);
 await db.close();
});
