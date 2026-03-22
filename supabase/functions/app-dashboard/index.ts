import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  claimCodePayload,
  createAdminClient,
  handleCors,
  handleError,
  json,
  offlineStatus,
  publicUser,
  requireUser,
} from "../_shared/helpers.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    const user = await requireUser(req);
    const admin = createAdminClient();
    const now = new Date().toISOString();

    const { data: activeClaimCode, error: claimError } = await admin
      .from("sensor_claim_codes")
      .select("code, expires_at, used_at, claimed_sensor_id, created_at")
      .eq("user_id", user.id)
      .is("used_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (claimError) {
      throw claimError;
    }

    const { data: sensors, error: sensorError } = await admin
      .from("sensors")
      .select("id, name, device_uid, firmware_version, capabilities, upload_interval_minutes, created_at, claimed_at, last_seen_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (sensorError) {
      throw sensorError;
    }

    const sensorIds = (sensors || []).map((sensor) => sensor.id);
    const latestBySensor = new Map<string, Record<string, unknown>>();
    if (sensorIds.length) {
      const { data: latestReadings, error: readingError } = await admin
        .from("sensor_latest_readings")
        .select("sensor_id, temperature_c, humidity_pct, battery_mv, battery_pct, captured_at, received_at")
        .in("sensor_id", sensorIds);
      if (readingError) {
        throw readingError;
      }
      for (const reading of latestReadings || []) {
        latestBySensor.set(String(reading.sensor_id), reading);
      }
    }

    const items = (sensors || []).map((sensor) => {
      const latest = latestBySensor.get(sensor.id);
      const uploadIntervalMinutes = Number(sensor.upload_interval_minutes || 60);
      return {
        id: sensor.id,
        name: sensor.name,
        deviceUid: sensor.device_uid,
        firmwareVersion: sensor.firmware_version || "",
        capabilities: sensor.capabilities || [],
        uploadIntervalMinutes,
        createdAt: sensor.created_at,
        claimedAt: sensor.claimed_at,
        lastSeenAt: sensor.last_seen_at,
        online: offlineStatus(sensor.last_seen_at, uploadIntervalMinutes),
        latestReading: latest
          ? {
              temperatureC: latest.temperature_c,
              humidityPct: latest.humidity_pct,
              batteryMv: latest.battery_mv,
              batteryPct: latest.battery_pct,
              capturedAt: latest.captured_at,
              receivedAt: latest.received_at,
            }
          : null,
      };
    });

    return json({
      user: publicUser(user),
      activeClaimCode: claimCodePayload(activeClaimCode),
      items,
    });
  } catch (error) {
    return handleError(error);
  }
});
