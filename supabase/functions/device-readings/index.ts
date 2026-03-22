import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  createAdminClient,
  handleCors,
  handleError,
  HttpError,
  json,
  parseBearer,
  parseJson,
  requireString,
  toNumber,
} from "../_shared/helpers.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    const admin = createAdminClient();
    const deviceToken = parseBearer(req.headers.get("Authorization"));
    const payload = await parseJson<Record<string, unknown>>(req);
    const sensorId = requireString(payload, "sensor_id", "Sensor ID");

    const { data: sensor, error: sensorError } = await admin
      .from("sensors")
      .select("id, upload_interval_minutes")
      .eq("device_token", deviceToken)
      .maybeSingle();
    if (sensorError) {
      throw sensorError;
    }
    if (!sensor) {
      throw new HttpError("Device-token er ugyldig.", 401);
    }
    if (sensor.id !== sensorId) {
      throw new HttpError("Sensor ID matcher ikke token.", 403);
    }

    const capturedAt = String(payload.captured_at || new Date().toISOString()).trim();
    const reading = {
      sensor_id: sensorId,
      temperature_c: toNumber(payload.temperature_c, "temperature_c"),
      humidity_pct: toNumber(payload.humidity_pct, "humidity_pct"),
      battery_mv: toNumber(payload.battery_mv, "battery_mv"),
      battery_pct: toNumber(payload.battery_pct, "battery_pct"),
      captured_at: capturedAt,
    };

    const { error: insertError } = await admin.from("sensor_readings").insert(reading);
    if (insertError) {
      throw insertError;
    }

    const { error: updateError } = await admin
      .from("sensors")
      .update({
        last_seen_at: new Date().toISOString(),
        firmware_version: String(payload.firmware_version || ""),
      })
      .eq("id", sensorId);
    if (updateError) {
      throw updateError;
    }

    return json({
      ok: true,
      next_upload_interval_minutes: Number(sensor.upload_interval_minutes || 60),
      config_version: 1,
    });
  } catch (error) {
    return handleError(error);
  }
});
