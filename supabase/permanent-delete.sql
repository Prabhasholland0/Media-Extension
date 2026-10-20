begin;
create function public.permanently_delete_member(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(823714);
 if auth.uid() is null or not public.is_team_admin() then raise exception 'Admin access required';end if;
 if p_user is null or p_user=auth.uid() then raise exception 'You cannot remove your own account';end if;
 if exists(select 1 from public.profiles where id=p_user and is_admin) then raise exception 'Administrator accounts cannot be removed here';end if;
 if not exists(select 1 from public.profiles where id=p_user) then raise exception 'Member not found';end if;
 update public.schedules set status='draft',revision=revision+1,updated_at=now() where id in(select schedule_id from public.assignments where user_id=p_user);
 delete from public.assignments where user_id=p_user;
 update public.schedules set updated_by=null where updated_by=p_user;
 delete from auth.users where id=p_user;
end;
$$;
revoke execute on function public.permanently_delete_member(uuid) from public,anon;
grant execute on function public.permanently_delete_member(uuid) to authenticated;
commit;
