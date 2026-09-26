// Admin client. Skips RLS. Server only: never import this in client code.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
