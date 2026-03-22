import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  claimCodePayload,
  createAdminClient,
  handleCors,
  handleError,
  HttpError,
  json,
  randomCode,
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
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    let inserted = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await admin
        .from("sensor_claim_codes")
        .insert({
          user_id: user.id,
          code: randomCode(),
          expires_at: expiresAt,
        })
        .select("code, expires_at, used_at, claimed_sensor_id")
        .single();

      if (!error) {
        inserted = data;
        break;
      }

      if (!error.message.toLowerCase().includes("duplicate")) {
        throw error;
      }
    }

    if (!inserted) {
      throw new HttpError("Klarte ikke generere claim code.", 500);
    }

    return json({ claimCode: claimCodePayload(inserted) }, 201);
  } catch (error) {
    return handleError(error);
  }
});
