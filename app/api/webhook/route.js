const VERIFY_TOKEN = "leonardo123";

// GET = validação do webhook
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

// POST = mensagens recebidas
export async function POST(req) {
  try {
    const body = await req.json();
    console.log("WEBHOOK BODY:", JSON.stringify(body, null, 2));

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) {
      return new Response("NO_MESSAGE", { status: 200 });
    }

    const from = message.from;
    const text = message.text?.body || "";

    const answer = await gerarRespostaComGPT(text);
    await enviarMensagemWhatsApp(from, answer);

    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (err) {
    console.error("Erro no webhook:", err);
    return new Response("ERROR", { status: 500 });
  }
}

async function gerarRespostaComGPT(text) {
  const apiKey = process.env.OPENAI_API_KEY;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Você é a secretária virtual do escritório Leonardo Abreu Advocacia. Responda em português, com educação e objetividade.",
        },
        { role: "user", content: text },
      ],
      max_tokens: 300,
    }),
  });

  const data = await resp.json();
  return (
    data.choices?.[0]?.message?.content ||
    "Desculpe, tive um problema para responder agora."
  );
}

async function enviarMensagemWhatsApp(to, text) {
  const token = process.env.WPP_TOKEN;
  const phoneId = process.env.WPP_PHONE_ID;

  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  const data = await resp.json();
  console.log("RESPOSTA ENVIO WHATSAPP:", data);
}
