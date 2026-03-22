import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  createAdminClient,
  env,
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
    const currentPassword = requireString(payload, "currentPassword", "Nåværende passord");
    const newPassword = requireString(payload, "newPassword", "Nytt passord");

    if (newPassword.length < 8) {
      throw new HttpError("Nytt passord må være minst 8 tegn.", 400);
    }
    if (!user.email) {
      throw new HttpError("Brukeren mangler e-postadresse.", 400);
    }

    const anonClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const { error: signInError } = await anonClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInError) {
      throw new HttpError("Nåværende passord er feil.", 401);
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (error) {
      throw error;
    }

    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
});
