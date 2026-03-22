with test_profile as (
  select id
  from public.profiles
  where lower(display_name) = 'test'
  limit 1
),
demo_sensors as (
  select
    tp.id as user_id,
    sensor.device_uid,
    sensor.name,
    sensor.firmware_version,
    sensor.upload_interval_minutes,
    sensor.last_seen_at,
    sensor.temperature_c,
    sensor.humidity_pct,
    sensor.battery_pct
  from test_profile tp
  cross join (
    values
      (
        'jordd-demo-stue',
        'Stue',
        'demo-v1',
        60,
        now() - interval '18 minutes',
        21.4::numeric,
        46::numeric,
        88::numeric
      ),
      (
        'jordd-demo-soverom',
        'Soverom',
        'demo-v1',
        60,
        now() - interval '42 minutes',
        19.8::numeric,
        52::numeric,
        73::numeric
      ),
      (
        'jordd-demo-drivhus',
        'Drivhus',
        'demo-v1',
        60,
        now() - interval '4 hours',
        27.1::numeric,
        68::numeric,
        61::numeric
      ),
      (
        'jordd-demo-garasje',
        'Garasje',
        'demo-v1',
        60,
        now() - interval '7 hours',
        8.9::numeric,
        58::numeric,
        54::numeric
      )
  ) as sensor(device_uid, name, firmware_version, upload_interval_minutes, last_seen_at, temperature_c, humidity_pct, battery_pct)
),
upserted as (
  insert into public.sensors (
    user_id,
    device_uid,
    name,
    firmware_version,
    capabilities,
    device_token,
    upload_interval_minutes,
    claimed_at,
    last_seen_at
  )
  select
    ds.user_id,
    ds.device_uid,
    ds.name,
    ds.firmware_version,
    '["demo"]'::jsonb,
    replace(gen_random_uuid()::text, '-', ''),
    ds.upload_interval_minutes,
    now(),
    ds.last_seen_at
  from demo_sensors ds
  on conflict (device_uid) do update
    set user_id = excluded.user_id,
        name = excluded.name,
        firmware_version = excluded.firmware_version,
        capabilities = excluded.capabilities,
        upload_interval_minutes = excluded.upload_interval_minutes,
        last_seen_at = excluded.last_seen_at
  returning id, device_uid
)
insert into public.sensor_readings (
  sensor_id,
  temperature_c,
  humidity_pct,
  battery_pct,
  captured_at
)
select
  s.id,
  ds.temperature_c,
  ds.humidity_pct,
  ds.battery_pct,
  ds.last_seen_at
from public.sensors s
join demo_sensors ds on ds.device_uid = s.device_uid
where not exists (
  select 1
  from public.sensor_readings sr
  where sr.sensor_id = s.id
);
