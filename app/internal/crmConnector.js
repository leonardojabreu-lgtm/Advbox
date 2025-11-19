import { montarResumoInterno } from "./utils/formatters";

// Por enquanto, apenas gera o objeto e registra em log.
// Depois podemos adaptar para salvar em tabelas Supabase (crm_clients, crm_cases, crm_tasks).
export async function upsertLeadFromAnalysis(userNumber, analysis) {
  if (!analysis) return;

  try {
    const payload = {
      userNumber,
      tipoCaso: analysis.tipoCaso || "indefinido",
      subtipo: analysis.subtipo || "indefinido",
      nome: analysis.nomeProvavel || "",
      cidadeBairro: analysis.cidadeBairroProvavel || "",
      empresaEnvolvida: analysis.empresaEnvolvida || "",
      diasSemServicoOuProblemaDesde: analysis.diasSemServicoOuProblemaDesde || "",
      temCriancaIdosoDoenteEmCasa: analysis.temCriancaIdosoDoenteEmCasa,
      haPrejuizoDireto: analysis.haPrejuizoDireto,
      descricaoPrejuizos: analysis.descricaoPrejuizos || "",
      temProtocolos: analysis.temProtocolos,
      listaProtocolos: analysis.listaProtocolos || [],
      urgencia: analysis.urgencia || "media",
      acoesInternasSugeridas: analysis.acoesInternasSugeridas || [],
      observacoesInternas: analysis.observacoesInternas || "",
      resumoInterno: montarResumoInterno(analysis),
      createdAt: new Date().toISOString(),
    };

    console.log("CRM interno (lead/caso/tarefas):", JSON.stringify(payload, null, 2));

    // Aqui futuramente:
    // - salvar em Supabase (crm_clients, crm_cases, crm_tasks)
    // - criar tarefas internas no seu sistema jurídico
    // - disparar notificação para secretaria

    return payload;
  } catch (err) {
    console.error("Erro upsertLeadFromAnalysis:", err);
    return null;
  }
}
