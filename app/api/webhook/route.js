const VERIFY_TOKEN = "leonardo123";

// 🔵 Sessões simples em memória
// Estrutura: sessions[phone] = { step: 0-6, history: [] }
const sessions = {};

// -----------------------------------------------------
// 🚀 GET: Validação de Webhook
// -----------------------------------------------------
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Token inválido", { status: 403 });
}

// -----------------------------------------------------
// 🚀 POST: Recebimento de mensagem do WhatsApp
// -----------------------------------------------------
export async function POST(req) {
  const body = await req.json();
  console.log("POST webhook:", JSON.stringify(body, null, 2));

  try {
    const entry = body.entry?.[0];
    const msg = entry?.changes?.[0]?.value?.messages?.[0];

    if (!msg || msg.type !== "text") {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const from = msg.from;
    const text = msg.text.body.trim();

    const token = process.env.WPP_TOKEN;
    const phoneNumberId = process.env.WPP_PHONE_ID;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!sessions[from]) {
      sessions[from] = {
        step: 0,
        history: []
      };
    }

    // Atualiza histórico
    sessions[from].history.push({
      user: text,
      timestamp: Date.now()
    });

    // 🧠 Decide qual etapa estamos
    const step = sessions[from].step;
    const reply = await gerarRespostaCarolina(step, text, sessions[from].history);

    // Avança o passo lógico
    sessions[from].step = definirProximoPasso(step, text);

    // Envia resposta
    await enviarMensagemWhatsApp(phoneNumberId, token, from, reply);

  } catch (error) {
    console.error("Erro no webhook:", error);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

// -----------------------------------------------------
// 🧠 Função principal: Carolina com estados
// -----------------------------------------------------
async function gerarRespostaCarolina(step, userText, history) {

  const openaiKey = process.env.OPENAI_API_KEY;

  const systemPrompt = `
Você é CAROLINA, secretária virtual de um escritório de advocacia em Niterói/RJ.
Siga EXATAMENTE o fluxo abaixo, sem reiniciar mensagens anteriores.

ETAPAS:
0 → Apresentação inicial.
1 → Perguntar qual é o tipo do problema.
2 → Fazer perguntas essenciais do caso (água/luz/internet).
3 → Fazer resumo.
4 → Pedir documentos.
5 → Encerrar e informar que enviará ao advogado.

HISTÓRICO:
${history.map(h => `Cliente: ${h.user}`).join("\n")}

RESPONDA APENAS de acordo com a etapa atual: ${step}
Não repita a apresentação se step > 0.
Nunca faça perguntas fora da ordem.
Use linguagem acolhedora e clara.
  `;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      max_tokens: 300,
      temperature: 0.3
    })
  });

  const data = await response.json();
  console.log("GPT:", data);
  return data.choices?.[0]?.message?.content || "Certo, pode me explicar melhor?";
}

// -----------------------------------------------------
// 📌 Avançar etapa da conversa
// -----------------------------------------------------
function definirProximoPasso(step, userText) {
  switch (step) {
    case 0: return 1;
    case 1: return 2;
    case 2:
      // quando coletou informações básicas
      if (userText.length > 5) return 3;
      return 2;
    case 3: return 4;
    case 4: return 5;
    default: return step;
  }
}

// -----------------------------------------------------
// 📤 Enviar mensagem pelo WhatsApp
// -----------------------------------------------------
async function enviarMensagemWhatsApp(phoneNumberId, token, to, text) {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });

  const data = await resp.json();
  console.log("WhatsApp API:", data);
}
