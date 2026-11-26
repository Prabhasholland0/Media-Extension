alter table public.profiles add column approval_pending boolean not null default false;
alter table public.profiles alter column approval_pending set default true;
create function service_team_private.enforce_member_approval() returns trigger language plpgsql set search_path='' as $$
begin
if TG_OP='INSERT' then new.active:=false;new.approval_pending:=true;
elsif old.approval_pending and new.active then
if not public.is_team_admin() then raise exception 'Administrator approval required'; end if;
new.approval_pending:=false;
end if;return new;end $$;
create trigger enforce_member_approval before insert or update on public.profiles for each row execute function service_team_private.enforce_member_approval();
revoke all on function service_team_private.enforce_member_approval() from public,anon,authenticated;
