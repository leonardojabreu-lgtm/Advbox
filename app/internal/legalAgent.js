import { callOpenAIForAnalysis } from "./legalOpenAiHelper"; // opcional, mas pra simplificar vamos direto no fetch abaixo

export async function runLegalAnalysis(openaiKey, userId, history) {
  try {
    const mensagensCliente = history
      .filter((m) => m.role !== "assistant")
      .map((m) => m.content)
      .join("\n---\n");

    const systemPrompt = `
Você é um assistente jurídico interno (NÃO fala com o cliente).
Sua função é ler o histórico de conversa entre a secretária CAROLINA e o cliente e gerar um resumo estruturado do caso, APENAS para uso interno do escritório.

Retorne SEMPRE um JSON válido com os campos:

{
  "nome": string | null,
  "cidade_bairro": string | null,
  "tipo_problema": "agua" | "luz" | "internet" | "telefone" | "banco" | "outro" | null,
  "empresa": string | null,
  "dias_sem_servico": string | null,
  "ha_idoso_ou_crianca": boolean | null,
  "prejuizos": string | null,
  "protocolos": string[] | [],
  "contas_em_dia": boolean | null,
  "parece_caso_relevante": boolean,
  "observacoes": string
}

Não inclua comentários fora do JSON.
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Histórico de mensagens do cliente ${userId}:\n\n${mensagensCliente}`,
          },
        ],
        max_tokens: 600,
        temperature: 0.1,
      }),
    });

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("Falha ao parsear JSON da análise jurídica:", raw);
      return null;
    }

    return parsed;
  } catch (err) {
    console.error("Erro em runLegalAnalysis:", err);
    return null;
  }
}
