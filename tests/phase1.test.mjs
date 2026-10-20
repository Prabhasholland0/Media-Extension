import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migrationOrder} from './migrations.mjs';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated;`);
 for(const f of migrationOrder)await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
 return db;
}
test('every migration applies in the documented order on top of NLAG data',async()=>{
 const db=await setup();
 assert.equal((await db.query(`select count(*)::int n from public.services`)).rows[0].n,6,'NLAG services preserved');
 await db.close();
});
test('platform sign-ups stay out of the NLAG team app',async()=>{
 const db=await setup();
 await db.query(`insert into auth.users values($1,'nlag-admin@example.com','{"full_name":"NLAG Admin"}'),($2,'volunteer@example.com','{"full_name":"Volunteer"}'),($3,'other-church@example.com','{"full_name":"Other Church","app":"mediahub-platform"}')`,[id(1),id(2),id(3)]);
 await db.query(`update public.profiles set is_admin=(id=$1),phone='12345',skills=array['camera','producer','ccu']`,[id(1)]);
 assert.deepEqual((await db.query(`select id,legacy_team from public.profiles order by id`)).rows.map(r=>r.legacy_team),[true,true,false]);
 await db.exec('set role authenticated');
 const as=u=>db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[u]);
 await as(id(3));
 assert.equal((await db.query(`select public.is_active_member() a`)).rows[0].a,false);
 await assert.rejects(()=>db.query(`select public.submit_availability('2026-11-01',array['first'])`),/active account/);
 assert.equal((await db.query(`select * from public.published_schedule('2026-11-01')`)).rows.length,0);
 await as(id(1));
 assert.deepEqual((await db.query(`select email from public.profiles order by email`)).rows.map(r=>r.email),['nlag-admin@example.com','volunteer@example.com'],'NLAG admin cannot read platform users');
 await assert.rejects(()=>db.query(`select public.manage_member($1,array['camera'],true)`,[id(3)]),/Member not found/);
 await assert.rejects(()=>db.query(`select public.permanently_delete_member($1)`,[id(3)]),/Member not found/);
 // Existing NLAG flow still works.
 await as(id(2));await db.query(`select public.submit_availability('2026-11-01',array['first'])`);
 await as(id(1));assert.equal((await db.query(`select * from public.availability where user_id=$1`,[id(2)])).rows.length,4);
 await db.close();
});
test('invite codes are admin-only, guessing is throttled, creators can be deleted',async()=>{
 const db=await setup();
 for(const n of [1,2,3])await db.query(`insert into auth.users values($1,$2,'{"app":"mediahub-platform"}')`,[id(n),`u${n}@example.com`]);
 await db.exec('set role authenticated');
 const as=u=>db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[u]);
 await as(id(1));
 const org=(await db.query(`select public.create_organization('Grace','blank') id`)).rows[0].id;
 const code=(await db.query(`select public.org_invite_code($1) c`,[org])).rows[0].c;
 assert.match(code,/^[0-9A-F]{8}$/);
 await assert.rejects(()=>db.query(`select join_code from public.organizations`),/permission denied/);
 await as(id(2));await db.query(`select public.join_organization($1)`,[code]);
 assert.equal((await db.query(`select public.org_invite_code($1) c`,[org])).rows[0].c,null,'members do not get the code');
 assert.equal((await db.query(`select name from public.organizations`)).rows[0].name,'Grace');
 await as(id(3));
 for(let i=0;i<10;i++)assert.equal((await db.query(`select public.join_organization('BAD00000') id`)).rows[0].id,null);
 await assert.rejects(()=>db.query(`select public.join_organization($1)`,[code]),/Too many invalid/,'even a correct code waits after 10 misses');
 await db.exec('reset role');
 await db.query(`delete from public.org_members where user_id=$1`,[id(1)]);
 await db.query(`delete from auth.users where id=$1`,[id(1)]);
 assert.equal((await db.query(`select created_by from public.organizations`)).rows[0].created_by,null,'deleting the creator keeps the organization');
 await db.close();
});
