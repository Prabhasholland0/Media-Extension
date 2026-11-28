alter table public.assignment_notifications drop constraint assignment_notifications_position_check;
alter table public.assignment_notifications add constraint assignment_notifications_position_check check (position in ('producer','ccu') or position ~ '^cam_([1-9]|1[0-6])$');
