import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
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

    const { count, error } = await admin
      .from("sensors")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", user.id);
    if (error) {
      throw error;
    }

    const { data: sensors, error: sensorsError } = await admin
      .from("sensors")
      .select("id, name, device_uid, upload_interval_minutes, last_seen_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (sensorsError) {
      throw sensorsError;
    }

    return json({
      user: publicUser(user),
      stats: {
        sensorCount: count || 0,
      },
      sensors: (sensors || []).map((sensor) => ({
        id: sensor.id,
        name: sensor.name,
        deviceUid: sensor.device_uid,
        createdAt: sensor.created_at,
        lastSeenAt: sensor.last_seen_at,
        uploadIntervalMinutes: sensor.upload_interval_minutes,
        online: offlineStatus(sensor.last_seen_at, Number(sensor.upload_interval_minutes || 60)),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
});
