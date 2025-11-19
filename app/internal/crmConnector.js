// Aqui no futuro você pode integrar com ADVBox, Notion, planilha, etc.

export async function upsertLeadFromAnalysis(userId, analysis) {
  try {
    console.log("CRM: upsert lead", {
      userId,
      analysis,
    });

    // Exemplo futuro:
    // await fetch("https://sua-api-do-crm.com/leads", { ... })

    return true;
  } catch (err) {
    console.error("Erro ao enviar lead para o CRM:", err);
    return false;
  }
}
