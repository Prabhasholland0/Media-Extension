begin;
create schema if not exists service_team_private;
create table service_team_private.phone_signin_limits(bucket text primary key,started_at timestamptz not null,attempts integer not null);
alter table service_team_private.phone_signin_limits enable row level security;
revoke all on service_team_private.phone_signin_limits from public,anon,authenticated;
create function service_team_private.normalized_phone(p_phone text) returns text language sql immutable set search_path='' as $$
 select case when length(n)=10 then '91'||n when length(n)=11 and left(n,1)='0' then '91'||substr(n,2) else n end from (select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') n) x;
$$;
create function public.resolve_phone_signin(p_phone text) returns jsonb language plpgsql security definer set search_path='' as $$
declare normalized text; tries integer; matched_email text; matches integer;
begin
 normalized:=service_team_private.normalized_phone(p_phone);
 if length(normalized)<8 or length(normalized)>15 then return jsonb_build_object('allowed',true,'email',null);end if;
 perform pg_advisory_xact_lock(823715);
 delete from service_team_private.phone_signin_limits where started_at<now()-interval '15 minutes';
 insert into service_team_private.phone_signin_limits values('global',now(),1) on conflict(bucket) do update set attempts=case when phone_signin_limits.started_at<now()-interval '1 minute' then 1 else phone_signin_limits.attempts+1 end,started_at=case when phone_signin_limits.started_at<now()-interval '1 minute' then now() else phone_signin_limits.started_at end returning attempts into tries;
 if tries>120 then return jsonb_build_object('allowed',false);end if;
 insert into service_team_private.phone_signin_limits values(md5(normalized),now(),1) on conflict(bucket) do update set attempts=phone_signin_limits.attempts+1 returning attempts into tries;
 if tries>8 then return jsonb_build_object('allowed',false);end if;
 select count(*),min(u.email) into matches,matched_email from public.profiles p join auth.users u on u.id=p.id where service_team_private.normalized_phone(p.phone)=normalized;
 return jsonb_build_object('allowed',true,'email',case when matches=1 then matched_email else null end);
end;
$$;
revoke execute on function service_team_private.normalized_phone(text),public.resolve_phone_signin(text) from public,anon,authenticated;
grant execute on function public.resolve_phone_signin(text) to service_role;
commit;
