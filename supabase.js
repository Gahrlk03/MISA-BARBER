import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// COLOQUE OS DADOS DO SEU PROJETO AQUI

const SUPABASE_URL = "https://ojrmcxybalguxmdtptyj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_TLkDmPR8K3DtO-PAjL_0Jw_rZhxJGfI";

export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

export const configurado =
    !SUPABASE_URL.includes("COLE_AQUI") &&
    !SUPABASE_ANON_KEY.includes("COLE_AQUI");