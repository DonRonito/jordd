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
  publicUser,
  requireString,
} from "../_shared/helpers.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    const payload = await parseJson<Record<string, unknown>>(req);
    const identifier = requireString(payload, "identifier", "E-post eller brukernavn").toLowerCase();
    const password = requireString(payload, "password", "Passord");

    const admin = createAdminClient();
    let email = identifier;

    if (!identifier.includes("@")) {
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("email")
        .ilike("display_name", identifier)
        .maybeSingle();
      if (profileError) {
        throw profileError;
      }
      if (!profile?.email) {
        throw new HttpError("Feil e-post eller passord.", 401);
      }
      email = String(profile.email).toLowerCase();
    }

    const authClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session || !data.user) {
      throw new HttpError("Feil e-post eller passord.", 401);
    }

    return json({
      user: publicUser(data.user),
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (error) {
    return handleError(error);
  }
});
