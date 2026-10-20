import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migrationOrder} from './migrations.mjs';

// The one-file upgrade for the SQL editor must equal 004-009, refuse a second run, and leave nothing behind on failure.
test('PLATFORM-UPGRADE.sql installs 004-009 on an NLAG database once',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated;`);
 for(const f of migrationOrder.slice(0,migrationOrder.indexOf('004_platform.sql')))await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
 const sql=await readFile(new URL('../supabase/PLATFORM-UPGRADE.sql',import.meta.url),'utf8');
 await db.exec(sql);
 for(const t of ['organizations','org_roles','service_types','service_availability','notifications'])assert.ok((await db.query(`select to_regclass('public.${t}') r`)).rows[0].r,t);
 assert.ok((await db.query(`select 1 from pg_proc where proname='import_nlag'`)).rows.length);
 await assert.rejects(()=>db.exec(sql),/already installed/);
});
