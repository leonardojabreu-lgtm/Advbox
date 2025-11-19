export async function runLegalAnalysis(openaiKey, phone, history) {
  try {
    const messages = [
      {
        role: "system",
        content: `
Você é um AGENTE JURÍDICO. Sua função é ler todo o histórico de mensagens entre o cliente e a secretária Carolina e ORGANIZAR as informações objetivas abaixo.

IMPORTANTE:
- NÃO invente dados.
- Se algum dado não estiver claro, deixe como null.
- NÃO escreva mensagens longas.
- SUA RESPOSTA DEVE SER EM JSON PURO.

ESTRUTURA DO JSON FINAL:

{
 "nome": "...",
 "bairro": "...",
 "cidade": "...",
 "tipo_problema": "...",
 "empresa": "...",
 "dias_sem_servico": "...",
 "conta_em_dia": "...",
 "protocolos": ["...", "..."],
 "prejuizos": "...",
 "resumo_inicial": "TEXTO PRONTO PARA A INICIAL"
}

Agora leia o histórico e extraia essas informações.
        `
      },
      ...history.map(h => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content
      }))
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 0.2,
        max_tokens: 900
      })
    });

    const data = await response.json();
    const jsonText = data?.choices?.[0]?.message?.content;

    if (!jsonText) return null;

    return JSON.parse(jsonText);

  } catch (err) {
    console.error("Erro no agente jurídico:", err);
    return null;
  }
}
