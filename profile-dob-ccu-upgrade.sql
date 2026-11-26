alter table public.profiles add column if not exists date_of_birth date;
create or replace function public.save_profile(p_name text,p_phone text,p_avatar text,p_dob date) returns void language plpgsql security definer set search_path='' as $$
begin
if auth.uid() is null then raise exception 'Sign in required'; end if;
if p_dob>current_date or p_dob<date '1900-01-01' then raise exception 'Enter a valid date of birth'; end if;
perform public.save_profile(p_name,p_phone,p_avatar);
update public.profiles set date_of_birth=p_dob where id=auth.uid();
end; $$;
revoke all on function public.save_profile(text,text,text,date) from public,anon;
grant execute on function public.save_profile(text,text,text,date) to authenticated;
alter table public.schedules drop constraint schedules_not_needed_cameras_check;
alter table public.schedules add constraint schedules_not_needed_cameras_check check(not_needed_cameras <@ array['ccu','cam_1','cam_2','cam_3','cam_4','cam_5','cam_6','cam_7','cam_8','cam_9','cam_10','cam_11','cam_12','cam_13','cam_14','cam_15','cam_16']::text[]);
do $$ declare definition text; begin
select pg_get_functiondef('public.save_schedule(date,text,jsonb,boolean,integer,integer)'::regprocedure) into definition;
definition:=replace(definition, 'if entry.key not like ''cam_%'' then raise exception ''Only cameras can be marked Not needed'';', 'if entry.key not like ''cam_%'' and entry.key<>''ccu'' then raise exception ''Only cameras and CCU can be marked Standby'';');
execute definition;
end $$;
