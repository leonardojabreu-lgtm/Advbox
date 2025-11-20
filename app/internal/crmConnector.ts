export async function upsertLeadFromAnalysis(userId: string, analysisJson: string) {
  try {
    console.log("Análise jurídica (JSON):", analysisJson);
    // Aqui você pode integrar no Readdy depois
  } catch (err) {
    console.error("Erro ao salvar lead no CRM:", err);
  }
}
