const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Gera uma análise jurídica estruturada a partir do histórico do cliente
 * @param {string} openaiKey - OPENAI_API_KEY
 * @param {string} phone - número do cliente (ex: 5521...)
 * @param {Array} history - histórico vindo do Supabase (messages_memory)
 */
export async function runLegalAnalysis(openaiKey, phone, history) {
  try {
    if (!openaiKey) {
      console.warn("runLegalAnalysis: OPENAI_API_KEY ausente, ignorando análise.");
      return null;
    }

    if (!history || history.length === 0) {
      console.warn("runLegalAnalysis: histórico vazio, nada para analisar.");
      return null;
    }

    // Monta um texto contínuo com a conversa
    const conversa = history
      .map((m) => {
        const quem = m.role === "assistant" ? "CAROLINA" : "CLIENTE";
        return `${quem}: ${m.content}`;
      })
      .join("\n");

    const systemPrompt = `
Você é um ASSISTENTE JURÍDICO INTERNO de um escritório de advocacia.
Você NÃO fala com o cliente. Você só lê o histórico da conversa entre a secretária CAROLINA e o CLIENTE
e gera um resumo organizado do caso para uso interno.

Retorne SEMPRE e SOMENTE um JSON VÁLIDO (sem texto fora do JSON) com a seguinte
