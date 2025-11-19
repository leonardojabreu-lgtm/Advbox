import { resumirHistoricoSimples } from "./utils/formatters";

export async function runLegalAnalysis(openaiKey, userNumber, history) {
  try {
    if (!openaiKey || !history || history.length === 0) return null;

    const resumo = resumirHistoricoSimples(history);

    const systemPrompt = `
Você é um ASSISTENTE JURÍDICO INTERNO de um escritório de advocacia que atua com:

- Falta ou falha de serviços essenciais (água, luz, internet/telefone)
- Problemas com bancos (negativação indevida, débitos não reconhecidos, redução de limite etc.)

Sua função é APENAS organizar o caso para uso interno do escritório, em FORMATO ESTRUTURADO.

NUNCA fale com o cliente diretamente.
NUNCA dê opinião sobre probabilidade de êxito.
NUNCA cite artigos de lei, jurisprudência ou valores.

Retorne SEMPRE em JSON válido, com este formato:

{
  "tipoCaso": "servico_essencial" | "banco" | "duvida_geral" | "outro",
  "subtipo": "agua" | "luz" | "internet" | "telefone" | "limite" | "negativacao" | "debito" | "outro",
  "nomeProvavel": "string ou vazio",
  "cidadeBairroProvavel": "string ou vazio",
  "empresaEnvolvida": "string ou vazio",
  "diasSemServicoOuProblemaDesde": "string curta",
  "temCriancaIdosoDoenteEmCasa": true/false/null,
  "haPrejuizoDireto": true/false/null,
  "descricaoPrejuizos": "string curta",
  "temProtocolos": true/false/null,
  "listaProtocolos": ["...", "..."],
  "urgencia": "alta" | "media" | "baixa",
  "acoesInternasSugeridas": [
    "string 1",
    "string 2"
  ],
  "observacoesInternas": "texto curto para equipe interna"
}

Não escreva nada fora do JSON.
`;

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Histórico de conversa com o cliente (número ${userNumber}):\n${resumo}`,
      },
    ];

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        max_tokens: 400,
        temperature: 0.2,
      }),
    });

    const data = await resp.json();
    console.log("Resposta OpenAI (LegalAgent):", JSON.stringify(data, null, 2));

    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    // tenta parsear JSON
    try {
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      const jsonStr =
        jsonStart >= 0 && jsonEnd > jsonStart
          ? content.slice(jsonStart, jsonEnd + 1)
          : content;

      const parsed = JSON.parse(jsonStr);
      return parsed;
    } catch (e) {
      console.error("Erro ao parsear JSON do LegalAgent:", e, "content:", content);
      return null;
    }
  } catch (err) {
    console.error("Erro runLegalAnalysis:", err);
    return null;
  }
}
