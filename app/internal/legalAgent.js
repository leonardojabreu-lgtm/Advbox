export async function runLegalAnalysis(geminiKey, phone, history) {
  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=" +
      geminiKey;

    const systemPrompt = `
Você é um AGENTE JURÍDICO.
Sua função é ler todo o histórico de mensagens entre o cliente e a secretária CAROLINA
e extrair, de forma bem objetiva, os dados principais do caso para o advogado.

IMPORTANTE:
- NÃO invente dados.
- Se algum dado não estiver claro, deixe como null.
- NÃO escreva textos longos.
- SUA RESPOSTA DEVE SER EM JSON PURO, sem nenhum texto antes ou depois.

ESTRUTURA DO JSON FINAL:

{
  "nome": "...",
  "bairro": "...",
  "cidade": "...",
  "tipo_problema": "...",   // "água", "luz", "internet", "telefone", "banco", "outro"
  "empresa": "...",
  "dias_sem_servico": "...",
  "conta_em_dia": true,
  "protocolos": ["...", "..."],
  "prejuizos": "...",
  "resumo_inicial": "TEXTO PRONTO PARA A INICIAL"
}
`;

    const conversa = history
      .map((m) => {
        const quem = m.role === "assistant" ? "CAROLINA" : "CLIENTE";
        return `${quem}: ${m.content}`;
      })
      .join("\n");

    const userPrompt = `
${systemPrompt}

Abaixo está o histórico completo de mensagens entre CAROLINA e o CLIENTE (${phone}).

HISTÓRICO:
${conversa}

Agora, responda APENAS com um JSON válido seguindo exatamente a estrutura pedida.
`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log("Resposta do Gemini (agente jurídico):", JSON.stringify(data, null, 2));

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || "";

    if (!text) return null;

    // tenta converter o texto em JSON
    try {
      const json = JSON.parse(text);
      return json;
    } catch (e) {
      console.error("Falha ao fazer JSON.parse da resposta do Gemini:", text);
      return null;
    }
  } catch (err) {
    console.error("Erro em runLegalAnalysis:", err);
    return null;
  }
}
