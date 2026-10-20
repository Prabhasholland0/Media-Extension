-- Apply once to a NEW Supabase project with the SQL editor.
-- All application writes go through authorized, transactional RPCs.
begin;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '' check(length(full_name)<=100),
 email text not null, phone text not null default '' check(length(phone)<=30),
 avatar_url text not null default '', skills text[] not null default '{}'
 check(skills <@ array['camera','producer','ccu']::text[]),
 active boolean not null default true, is_admin boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.services(id text primary key, name text not null, sort_order int not null unique);
insert into public.services values ('first','1st Service',1),('second','2nd Service',2),('hindi','Hindi Service',3),('telugu','Telugu Service',4);
create table public.availability (
 user_id uuid not null references public.profiles(id) on delete cascade,
 service_date date not null, service_id text not null references public.services(id),
 status text not null check(status in ('available','not_available')),
 submitted_at timestamptz not null default now(), primary key(user_id,service_date,service_id)
);
-- Missing row means Not Submitted, never Not Available.
create index availability_day on public.availability(service_date,service_id,status);
create table public.schedules (
 id uuid primary key default gen_random_uuid(), service_date date not null,
 service_id text not null references public.services(id),
 status text not null default 'draft' check(status in ('draft','published')),
 revision integer not null default 1, updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id), unique(service_date,service_id)
);
create table public.assignments (
 schedule_id uuid not null references public.schedules(id) on delete cascade,
 position text not null check(position in ('producer','ccu','cam_1','cam_2','cam_3','cam_4','cam_5','cam_6','cam_7','cam_8')),
 user_id uuid not null references public.profiles(id),
 primary key(schedule_id,position), unique(schedule_id,user_id)
);
create function public.is_team_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and is_admin and active);
$$;
create function public.is_active_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active);
$$;
create function public.handle_new_member() returns trigger language plpgsql security definer set search_path='' as $$
 begin insert into public.profiles(id,email,full_name) values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'full_name',''),100)); return new; end;
$$;
create trigger create_member_profile after insert on auth.users for each row execute function public.handle_new_member();
-- Backfill users who registered before this migration, without granting admin rights.
insert into public.profiles(id,email,full_name) select id,coalesce(email,''),left(coalesce(raw_user_meta_data->>'full_name',''),100) from auth.users on conflict(id) do nothing;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.availability enable row level security;
alter table public.schedules enable row level security;
alter table public.assignments enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_team_admin());
create policy service_read on public.services for select to authenticated using(true);
create policy availability_read on public.availability for select to authenticated using(user_id=auth.uid() or public.is_team_admin());
create policy schedule_read on public.schedules for select to authenticated using(public.is_team_admin() or (status='published' and public.is_active_member()));
create policy assignment_read on public.assignments for select to authenticated using(public.is_team_admin() or (public.is_active_member() and exists(select 1 from public.schedules s where s.id=schedule_id and s.status='published')));
revoke all on public.profiles,public.services,public.availability,public.schedules,public.assignments from anon,authenticated;
grant select on public.profiles,public.services,public.availability,public.schedules,public.assignments to authenticated;
create function public.save_profile(p_name text,p_phone text,p_avatar text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_name is null or p_phone is null or length(trim(p_name))=0 or length(trim(p_phone))=0 then raise exception 'Name and phone are required'; end if;
 if p_avatar is null or (p_avatar<>'' and split_part(p_avatar,'/',1)<>auth.uid()::text) then raise exception 'Invalid profile photo'; end if;
 update public.profiles set full_name=trim(p_name),phone=trim(p_phone),avatar_url=p_avatar where id=auth.uid();
 end;
$$;
create function public.submit_availability(p_date date,p_services text[]) returns void language plpgsql security definer set search_path='' as $$
 declare affected uuid[];
 begin
 perform pg_advisory_xact_lock(823714);
 if not public.is_active_member() then raise exception 'An active account is required'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and length(trim(full_name))>0 and length(trim(phone))>0) then raise exception 'Complete your profile first'; end if;
 if p_date is null or p_services is null or array_position(p_services,null) is not null or not(p_services <@ array['first','second','hindi','telugu']::text[]) then raise exception 'Invalid services or date'; end if;
 select array_agg(distinct s.id) into affected from public.schedules s join public.assignments a on a.schedule_id=s.id where s.service_date=p_date and a.user_id=auth.uid() and not(s.service_id=any(p_services));
 update public.schedules set status='draft',revision=revision+1,updated_at=now() where id=any(affected);
 delete from public.assignments where user_id=auth.uid() and schedule_id=any(affected);
 insert into public.availability(user_id,service_date,service_id,status)
 select auth.uid(),p_date,id,case when id=any(p_services) then 'available' else 'not_available' end from public.services
 on conflict(user_id,service_date,service_id) do update set status=excluded.status,submitted_at=now();
 end;
$$;
create function public.manage_member(p_user uuid,p_skills text[],p_active boolean) returns void language plpgsql security definer set search_path='' as $$
 declare affected uuid[];
 begin
 perform pg_advisory_xact_lock(823714);
 if not public.is_team_admin() then raise exception 'Admin access required'; end if;
 if p_user=auth.uid() and not p_active then raise exception 'You cannot deactivate your own admin account'; end if;
 if p_skills is null or array_position(p_skills,null) is not null or not(p_skills <@ array['camera','producer','ccu']::text[]) or p_active is null then raise exception 'Invalid skills or account status'; end if;
 if not exists(select 1 from public.profiles where id=p_user) then raise exception 'Member not found'; end if;
 select array_agg(distinct schedule_id) into affected from public.assignments where user_id=p_user and (not p_active or not((case when position like 'cam_%' then 'camera' else position end)=any(p_skills)));
 update public.schedules set status='draft',revision=revision+1,updated_at=now() where id=any(affected);
 delete from public.assignments where user_id=p_user and (not p_active or not((case when position like 'cam_%' then 'camera' else position end)=any(p_skills)));
 update public.profiles set skills=p_skills,active=p_active where id=p_user;
 end;
$$;
create function public.save_schedule(p_date date,p_service text,p_assignments jsonb,p_publish boolean,p_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
 declare sid uuid; rev int; entry record; uid uuid; needed text;
 begin
 perform pg_advisory_xact_lock(823714);
 if not public.is_team_admin() then raise exception 'Admin access required'; end if;
 if p_date is null or p_service is null or p_publish is null or p_revision is null or p_assignments is null or jsonb_typeof(p_assignments)<>'object' then raise exception 'Invalid schedule'; end if;
 if not exists(select 1 from public.services where id=p_service) then raise exception 'Unknown service'; end if;
 select id,revision into sid,rev from public.schedules where service_date=p_date and service_id=p_service;
 if coalesce(rev,0)<>p_revision then raise exception 'Schedule changed since you opened it. Reload before saving.'; end if;
 if p_publish and (select count(*) from jsonb_object_keys(p_assignments))<>10 then raise exception 'Fill all 10 positions before publishing'; end if;
 for entry in select * from jsonb_each_text(p_assignments) loop
 if entry.key not in ('producer','ccu','cam_1','cam_2','cam_3','cam_4','cam_5','cam_6','cam_7','cam_8') or entry.value is null then raise exception 'Invalid assignment position'; end if;
 uid:=entry.value::uuid; needed:=case when entry.key like 'cam_%' then 'camera' else entry.key end;
 if not exists(select 1 from public.profiles p join public.availability a on a.user_id=p.id where p.id=uid and p.active and needed=any(p.skills) and a.service_date=p_date and a.service_id=p_service and a.status='available') then raise exception 'Member is unavailable, inactive, or ineligible for %',entry.key; end if;
 end loop;
 if sid is null then
 insert into public.schedules(service_date,service_id,status,updated_by) values(p_date,p_service,case when p_publish then 'published' else 'draft' end,auth.uid()) returning id into sid;
 else
 update public.schedules set status=case when p_publish then 'published' else 'draft' end,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=sid;
 end if;
 delete from public.assignments where schedule_id=sid;
 insert into public.assignments(schedule_id,position,user_id) select sid,key,value::uuid from jsonb_each_text(p_assignments);
 return sid;
 end;
$$;
create function public.published_schedule(p_date date) returns table(service_id text,"position" text,user_id uuid,full_name text) language sql stable security definer set search_path='' as $$
 select s.service_id,a.position,p.id,p.full_name from public.schedules s join public.assignments a on a.schedule_id=s.id join public.profiles p on p.id=a.user_id where s.service_date=p_date and s.status='published' and public.is_active_member();
$$;
revoke execute on function public.handle_new_member() from public,anon,authenticated;
revoke execute on function public.is_team_admin(),public.is_active_member(),public.save_profile(text,text,text),public.submit_availability(date,text[]),public.manage_member(uuid,text[],boolean),public.save_schedule(date,text,jsonb,boolean,integer),public.published_schedule(date) from public,anon;
grant execute on function public.is_team_admin(),public.is_active_member(),public.save_profile(text,text,text),public.submit_availability(date,text[]),public.manage_member(uuid,text[],boolean),public.save_schedule(date,text,jsonb,boolean,integer),public.published_schedule(date) to authenticated;
commit;

-- Apply supabase/camera-count.sql after this setup to enable the admin camera-count control.

-- Apply after 001_schema.sql in the same Supabase project's SQL editor.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy avatar_insert_own on storage.objects for insert to authenticated with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy avatar_read_authorized on storage.objects for select to authenticated using(bucket_id='avatars' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_team_admin()));
create policy avatar_delete_own on storage.objects for delete to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
