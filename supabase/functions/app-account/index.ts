import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  createAdminClient,
  handleCors,
  handleError,
  json,
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

    return json({
      user: publicUser(user),
      stats: {
        sensorCount: count || 0,
      },
    });
  } catch (error) {
    return handleError(error);
  }
});
