// Resumo simples para o LegalAgent
export function resumirHistoricoSimples(history = []) {
  return history
    .map((m) => {
      const prefix = m.role === "assistant" ? "Carolina:" : "Cliente:";
      return `${prefix} ${m.content}`;
    })
    .join("\n");
}

// Monta um resumo interno amigável para você/secretária
export function montarResumoInterno(analysis) {
  const partes = [];

  if (analysis.tipoCaso === "servico_essencial") {
    partes.push("Caso de serviço essencial (água/luz/internet/telefone).");
  } else if (analysis.tipoCaso === "banco") {
    partes.push("Caso bancário (cartão/conta/negativação).");
  } else {
    partes.push("Caso geral / outro tipo.");
  }

  if (analysis.subtipo && analysis.subtipo !== "outro") {
    partes.push(`Subtipo: ${analysis.subtipo}.`);
  }

  if (analysis.empresaEnvolvida) {
    partes.push(`Empresa envolvida: ${analysis.empresaEnvolvida}.`);
  }

  if (analysis.diasSemServicoOuProblemaDesde) {
    partes.push(`Problema desde: ${analysis.diasSemServicoOuProblemaDesde}.`);
  }

  if (analysis.haPrejuizoDireto) {
    partes.push(`Há prejuízos diretos relatados: ${analysis.descricaoPrejuizos || ""}`.trim());
  }

  partes.push(`Urgência percebida: ${analysis.urgencia || "não definida"}.`);

  return partes.join(" ");
}
