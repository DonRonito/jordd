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
    const email = requireString(payload, "email", "E-post").toLowerCase();
    const displayName = requireString(payload, "displayName", "Navn");

    if (!email.includes("@")) {
      throw new HttpError("E-postadressen ser ugyldig ut.", 400);
    }

    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
      email,
      user_metadata: {
        ...(user.user_metadata || {}),
        display_name: displayName,
      },
    });
    if (authError) {
      if (authError.message.toLowerCase().includes("already")) {
        throw new HttpError("Denne e-posten er allerede i bruk.", 409);
      }
      throw authError;
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({ email, display_name: displayName })
      .eq("id", user.id);
    if (profileError) {
      throw profileError;
    }

    return json({
      user: {
        id: user.id,
        email,
        displayName,
      },
    });
  } catch (error) {
    return handleError(error);
  }
});
