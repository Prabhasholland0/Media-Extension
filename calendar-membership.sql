create table public.calendar_events(id uuid primary key default gen_random_uuid(),event_date date not null,title text not null check(length(trim(title)) between 1 and 160),created_by uuid not null default auth.uid(),created_at timestamptz not null default now());
alter table public.calendar_events enable row level security;
grant select,insert on public.calendar_events to authenticated;
create policy calendar_read on public.calendar_events for select to authenticated using(public.is_active_member() or public.is_team_admin());
create policy calendar_add on public.calendar_events for insert to authenticated with check(public.is_team_admin() and created_by=auth.uid());
create function public.reject_membership(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
if not public.is_team_admin() then raise exception 'Admin access required';end if;
update public.profiles set approval_pending=false,active=false where id=p_user and approval_pending and not is_admin;
if not found then raise exception 'Pending member not found';end if;
end $$;
revoke all on function public.reject_membership(uuid) from public,anon;
grant execute on function public.reject_membership(uuid) to authenticated;
