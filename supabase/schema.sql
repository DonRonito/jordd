create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists sensors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
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

create table if not exists sensor_readings (
  id uuid primary key default gen_random_uuid(),
  sensor_id uuid not null references sensors(id) on delete cascade,
  temperature_c numeric,
  humidity_pct numeric,
  battery_mv numeric,
  battery_pct numeric,
  captured_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table if not exists sensor_claim_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  claimed_sensor_id uuid references sensors(id) on delete set null
);
