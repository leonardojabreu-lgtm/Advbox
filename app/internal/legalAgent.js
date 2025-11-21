// app/internal/legalAgent.js
import OpenAI from "openai";

export async function runLegalAnalysis(openaiKey, phone, history) {
  try {
    if (!openaiKey) return null;

    const client = new OpenAI({ apiKey: openaiKey });

    const mensagens = history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const system = `
Você é um AGENTE JURÍDICO especializado em Direito do Consumidor
(com foco em água, luz, internet/telefonia e bancos).

Sua função é ler todo o histórico de mensagens entre o cliente e a secretária Carolina
e extrair um RESUMO ESTRUTURADO em JSON.

NUNCA invente dados. Se algo não estiver claro, deixe como null.

Estrutura do JSON final:

{
  "nome": "...",
  "telefone": "...",
  "cidade": "...",
  "bairro": "...",
  "tipo_problema": "...",        // "luz", "agua", "internet", "telefone", "banco", "outro"
  "empresa": "...",
  "dias_sem_servico": "...",     // número ou string, use null se não souber
  "conta_em_dia": true/false/null,
  "crianca_idoso_doente": "...", // descreva brevemente ou null
  "protocolos": ["...", "..."],
  "prejuizos": "...",            // perdas de alimentos, perda de renda, etc.
  "resumo_inicial": "TEXTO PRONTO PARA A INICIAL, EM 1º PESSOA DO AUTOR"
}

Retorne APENAS o JSON puro, sem comentários, sem texto antes ou depois.
`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 800,
      messages: [
        { role: "system", content: system },
        ...mensagens,
      ],
    });

    const content = resp.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    try {
      const json = JSON.parse(content);
      return json;
    } catch (err) {
      console.error("Falha ao fazer parse do JSON da análise jurídica:", err);
      return null;
    }
  } catch (err) {
    console.error("Erro em runLegalAnalysis:", err);
    return null;
  }
}
