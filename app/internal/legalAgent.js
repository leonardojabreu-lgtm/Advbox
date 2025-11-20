export async function runLegalAnalysis(openaiKey: string, userId: string, history: any[]) {
  try {
    const conversation = history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Extraia dados jurídicos do caso em JSON estruturado." },
          { role: "user", content: conversation }
        ],
        max_tokens: 400
      })
    });

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("Erro no legalAgent:", err);
    return null;
  }
}
