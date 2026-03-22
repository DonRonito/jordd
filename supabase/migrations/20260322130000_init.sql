create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sensors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_uid text not null unique,
  name text not null,
  firmware_version text not null default '',
  capabilities jsonb not null default '[]'::jsonb,
  device_token text not null unique,
  upload_interval_minutes integer not null default 60,
  created_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.sensor_readings (
  id uuid primary key default gen_random_uuid(),
  sensor_id uuid not null references public.sensors(id) on delete cascade,
  temperature_c numeric,
  humidity_pct numeric,
  battery_mv numeric,
  battery_pct numeric,
  captured_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table if not exists public.sensor_claim_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  claimed_sensor_id uuid references public.sensors(id) on delete set null
);

create index if not exists sensors_user_id_idx on public.sensors(user_id);
create index if not exists sensor_readings_sensor_id_idx on public.sensor_readings(sensor_id, captured_at desc);
create index if not exists sensor_claim_codes_user_id_idx on public.sensor_claim_codes(user_id, created_at desc);

create or replace view public.sensor_latest_readings as
select distinct on (sensor_id)
  sensor_id,
  temperature_c,
  humidity_pct,
  battery_mv,
  battery_pct,
  captured_at,
  received_at
from public.sensor_readings
order by sensor_id, captured_at desc, received_at desc;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1), 'Jordd-bruker')
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.sensors enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.sensor_claim_codes enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "sensors_select_own" on public.sensors;
create policy "sensors_select_own"
on public.sensors
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "sensor_readings_select_own" on public.sensor_readings;
create policy "sensor_readings_select_own"
on public.sensor_readings
for select
to authenticated
using (
  exists (
    select 1
    from public.sensors
    where public.sensors.id = sensor_readings.sensor_id
      and public.sensors.user_id = auth.uid()
  )
);

drop policy if exists "sensor_claim_codes_select_own" on public.sensor_claim_codes;
create policy "sensor_claim_codes_select_own"
on public.sensor_claim_codes
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "sensor_claim_codes_insert_own" on public.sensor_claim_codes;
create policy "sensor_claim_codes_insert_own"
on public.sensor_claim_codes
for insert
to authenticated
with check (auth.uid() = user_id);
