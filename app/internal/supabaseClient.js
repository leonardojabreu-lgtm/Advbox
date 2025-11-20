import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("❌ Variáveis SUPABASE_URL ou SUPABASE_ANON_KEY não foram definidas!");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
