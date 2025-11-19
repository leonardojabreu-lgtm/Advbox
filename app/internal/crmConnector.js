import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function upsertLeadFromAnalysis(phone, analysis) {
  try {
    if (!analysis) return;

    const { error } = await supabase
      .from("legal_leads")
      .upsert({
        phone,
        nome: analysis.nome || null,
        bairro: analysis.bairro || null,
        cidade: analysis.cidade || null,
        tipo_problema: analysis.tipo_problema || null,
        empresa: analysis.empresa || null,
        dias_sem_servico: analysis.dias_sem_servico || null,
        conta_em_dia: analysis.conta_em_dia || null,
        protocolos: analysis.protocolos || [],
        prejuizos: analysis.prejuizos || null,
        resumo_inicial: analysis.resumo_inicial || null,
        updated_at: new Date()
      });

    if (error) {
      console.error("Erro ao salvar lead no CRM:", error);
    }
  } catch (err) {
    console.error("Erro geral no CRM:", err);
  }
}
