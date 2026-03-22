import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
};

export function handleCors(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function env(name: string, fallback = "") {
  return Deno.env.get(name) ?? fallback;
}

export function requireString(payload: Record<string, unknown>, key: string, label: string) {
  const value = String(payload[key] ?? "").trim();
  if (!value) {
    throw new HttpError(`${label} mangler.`, 400);
  }
  return value;
}

export function parseJson<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

export function createAdminClient() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createUserClient(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new HttpError("Du må logge inn for å fortsette.", 401);
  }

  const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      apikey: env("SUPABASE_ANON_KEY"),
    },
  });

  if (!response.ok) {
    throw new HttpError("Du må logge inn for å fortsette.", 401);
  }

  const user = await response.json();
  if (!user?.id) {
    throw new HttpError("Du må logge inn for å fortsette.", 401);
  }

  return user;
}

export function publicUser(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) {
  const displayName = String(user.user_metadata?.display_name ?? "").trim() || String(user.email ?? "").split("@")[0] || "Jordd-bruker";
  return {
    id: user.id,
    email: user.email ?? "",
    displayName,
  };
}

export function claimCodePayload(record: Record<string, unknown> | null) {
  if (!record) {
    return null;
  }
  return {
    code: record.code,
    expiresAt: record.expires_at,
    usedAt: record.used_at ?? null,
    claimedSensorId: record.claimed_sensor_id ?? null,
  };
}

export function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

export function parseBearer(header: string | null) {
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    throw new HttpError("Mangler gyldig device-token.", 401);
  }
  return header.slice(7).trim();
}

export function toNumber(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    throw new HttpError(`${fieldName} må være et tall.`, 400);
  }
  return numeric;
}

export function offlineStatus(lastSeenAt: string | null, uploadIntervalMinutes: number) {
  if (!lastSeenAt) {
    return false;
  }
  const lastSeen = new Date(lastSeenAt);
  if (Number.isNaN(lastSeen.getTime())) {
    return false;
  }
  const offlineThresholdMs = uploadIntervalMinutes * 2 * 60 * 1000;
  return Date.now() - lastSeen.getTime() <= offlineThresholdMs;
}

export class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function handleError(error: unknown) {
  if (error instanceof HttpError) {
    return json({ error: error.message }, error.status);
  }

  if (error instanceof Error) {
    return json({ error: error.message }, 500);
  }

  return json({ error: "Uventet feil." }, 500);
}
