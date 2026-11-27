CREATE OR REPLACE FUNCTION public.submit_campus_availability(p_date date, p_services text[], p_campus text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare affected uuid[];
begin
 perform pg_advisory_xact_lock(823714);
 if auth.uid() is null or not public.is_active_member() then raise exception 'An active account is required'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and length(trim(full_name))>0 and length(trim(phone))>0) then raise exception 'Complete your profile first'; end if;
 if p_campus is null or p_campus not in ('kompally','eden_square') or p_date is null or p_services is null or array_position(p_services,null) is not null then raise exception 'Invalid campus, services or date'; end if;
 if exists(select 1 from unnest(p_services) chosen where not exists(select 1 from public.services where id=chosen and campus_id=p_campus and enabled and (service_date is null or service_date=p_date))) then raise exception 'Service does not belong to this campus'; end if;
 select array_agg(distinct s.id) into affected from public.schedules s join public.services svc on svc.id=s.service_id join public.assignments a on a.schedule_id=s.id where svc.campus_id=p_campus and svc.enabled and (svc.service_date is null or svc.service_date=p_date) and s.service_date=p_date and a.user_id=auth.uid() and not(s.service_id=any(p_services));
 update public.schedules set status='draft',revision=revision+1,updated_at=now() where id=any(affected);
 delete from public.assignments where user_id=auth.uid() and schedule_id=any(affected);
 insert into public.availability(user_id,service_date,service_id,status)
 select auth.uid(),p_date,id,case when id=any(p_services) then 'available' else 'not_available' end from public.services where campus_id=p_campus and enabled and (service_date is null or service_date=p_date)
 on conflict(user_id,service_date,service_id) do update set status=excluded.status,submitted_at=now();
end;
$function$

