import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  createAdminClient,
  handleCors,
  handleError,
  HttpError,
  json,
  parseJson,
  requireString,
} from "../_shared/helpers.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    const payload = await parseJson<Record<string, unknown>>(req);
    const claimCodeValue = requireString(payload, "claim_code", "Claim code").toUpperCase();
    const deviceUid = requireString(payload, "device_uid", "Device UID");
    const firmwareVersion = requireString(payload, "firmware_version", "Firmware version");
    const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities : [];
    const admin = createAdminClient();

    const { data: claimCode, error: claimError } = await admin
      .from("sensor_claim_codes")
      .select("id, user_id, expires_at, used_at, claimed_sensor_id")
      .eq("code", claimCodeValue)
      .maybeSingle();
    if (claimError) {
      throw claimError;
    }
    if (!claimCode) {
      throw new HttpError("Claim code ble ikke funnet.", 404);
    }
    if (claimCode.used_at) {
      throw new HttpError("Claim code er allerede brukt.", 409);
    }
    if (new Date(claimCode.expires_at).getTime() <= Date.now()) {
      throw new HttpError("Claim code har utløpt.", 410);
    }

    const { data: existingSensor, error: existingError } = await admin
      .from("sensors")
      .select("id, device_token, upload_interval_minutes")
      .eq("device_uid", deviceUid)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }
    if (existingSensor?.device_token) {
      throw new HttpError("Denne sensoren er allerede claimed.", 409);
    }

    const deviceToken = crypto.randomUUID() + crypto.randomUUID();
    let sensorRecord = null;

    if (existingSensor) {
      const { data, error } = await admin
        .from("sensors")
        .update({
          user_id: claimCode.user_id,
          firmware_version: firmwareVersion,
          capabilities,
          claimed_at: new Date().toISOString(),
          device_token: deviceToken,
        })
        .eq("id", existingSensor.id)
        .select("id, device_token, upload_interval_minutes")
        .single();
      if (error) {
        throw error;
      }
      sensorRecord = data;
    } else {
      const defaultName = `Jordd Sensor ${deviceUid.slice(-4)}`;
      const { data, error } = await admin
        .from("sensors")
        .insert({
          user_id: claimCode.user_id,
          device_uid: deviceUid,
          name: defaultName,
          firmware_version: firmwareVersion,
          capabilities,
          upload_interval_minutes: 60,
          device_token: deviceToken,
        })
        .select("id, device_token, upload_interval_minutes")
        .single();
      if (error) {
        throw error;
      }
      sensorRecord = data;
    }

    const { error: updateClaimError } = await admin
      .from("sensor_claim_codes")
      .update({
        used_at: new Date().toISOString(),
        claimed_sensor_id: sensorRecord.id,
      })
      .eq("id", claimCode.id);
    if (updateClaimError) {
      throw updateClaimError;
    }

    return json({
      sensor_id: sensorRecord.id,
      device_token: sensorRecord.device_token,
      upload_interval_minutes: sensorRecord.upload_interval_minutes,
    });
  } catch (error) {
    return handleError(error);
  }
});
