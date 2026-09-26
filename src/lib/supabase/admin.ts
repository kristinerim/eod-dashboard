import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client that bypasses RLS. Server-only — never import this
 * from a Client Component. Reserved for the small set of actions (cancel /
 * refund / delete) that must work on jobs from any day, not just today, plus
 * the public invoice-signing flow (src/app/sign/[token]) where there is no
 * signed-in user by design — that flow's authorization is the unguessable
 * signature_token, not a Supabase Auth session. Every other caller must
 * verify the request is from a signed-in user first.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
