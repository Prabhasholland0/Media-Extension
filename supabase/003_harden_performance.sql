-- Security and performance hardening for the live Service Team schema.
begin;

-- Cover foreign-key lookups used by eligibility changes and cascading checks.
create index if not exists assignments_user_id_idx on public.assignments(user_id);
create index if not exists availability_service_id_idx on public.availability(service_id);
create index if not exists schedules_service_id_idx on public.schedules(service_id);
create index if not exists schedules_updated_by_idx on public.schedules(updated_by);

-- Cache auth.uid() once per statement instead of recalculating it for every row.
create or replace function public.is_team_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from public.profiles
   where id=(select auth.uid()) and is_admin and active
 );
$$;

create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from public.profiles
   where id=(select auth.uid()) and active
 );
$$;

drop policy if exists profile_read on public.profiles;
create policy profile_read on public.profiles for select to authenticated
using(id=(select auth.uid()) or public.is_team_admin());

drop policy if exists availability_read on public.availability;
create policy availability_read on public.availability for select to authenticated
using(user_id=(select auth.uid()) or public.is_team_admin());

commit;
