import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  createAdminClient,
  handleCors,
  handleError,
  HttpError,
  json,
  parseJson,
  requireString,
  requireUser,
} from "../_shared/helpers.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    const user = await requireUser(req);
    const payload = await parseJson<Record<string, unknown>>(req);
    const sensorId = requireString(payload, "sensorId", "Sensor");
    const admin = createAdminClient();

    const { data: sensor, error: sensorError } = await admin
      .from("sensors")
      .select("id")
      .eq("id", sensorId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (sensorError) {
      throw sensorError;
    }
    if (!sensor) {
      throw new HttpError("Fant ikke sensoren på kontoen din.", 404);
    }

    const { error: deleteError } = await admin
      .from("sensors")
      .delete()
      .eq("id", sensorId)
      .eq("user_id", user.id);
    if (deleteError) {
      throw deleteError;
    }

    return json({ ok: true, sensorId });
  } catch (error) {
    return handleError(error);
  }
});
