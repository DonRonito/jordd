import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  createAdminClient,
  env,
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
    const email = requireString(payload, "email", "E-post").toLowerCase();
    const password = requireString(payload, "password", "Passord");
    const displayName = requireString(payload, "displayName", "Navn");
    const inviteCode = requireString(payload, "inviteCode", "Pilotkode");

    if (!email.includes("@")) {
      throw new HttpError("E-postadressen ser ugyldig ut.", 400);
    }
    if (password.length < 8) {
      throw new HttpError("Passord må være minst 8 tegn.", 400);
    }
    if (inviteCode !== env("JORDD_INVITE_CODE", "testpilot26")) {
      throw new HttpError("Pilotkoden er ugyldig.", 403);
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
      },
    });

    if (error) {
      if (error.message.toLowerCase().includes("already")) {
        throw new HttpError("Det finnes allerede en konto med denne e-posten.", 409);
      }
      throw error;
    }

    return json({ ok: true }, 201);
  } catch (error) {
    return handleError(error);
  }
});
