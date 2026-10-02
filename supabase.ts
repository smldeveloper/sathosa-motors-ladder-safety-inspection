import { createClient } from "@supabase/supabase-js";

// Anon key only. The service-role key is never used in this app.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);
