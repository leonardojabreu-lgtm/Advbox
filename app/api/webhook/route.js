export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const VERIFY_TOKEN = "leonardo123"; // precisa ser o MESMO da Meta

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Token inválido", { status: 403 });
}

export async function POST(req) {
  const body = await req.json();

  console.log("POST webhook:", JSON.stringify(body, null, 2));

  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    // Se não tiver mensagem, só confirma pra Meta
    if (!messages || messages.length === 0) {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const message = messages[0];

    // Só tratamos texto por enquanto
    if (message.type !== "text") {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const from = message.from;                 // número do cliente
    const userText = message.text?.body || ""; // texto que ele mandou

    const token = process.env.WPP_TOKEN;
    const phoneNumberId = process.env.WPP_PHONE_ID;

    if (!token || !phoneNumberId) {
      console.error("Faltando WPP_TOKEN ou WPP_PHONE_ID nas variáveis de ambiente");
      return new Response("Missing WhatsApp env vars", { status: 500 });
    }

    // RESPOSTA SIMPLES SÓ PRA TESTE
    const replyText = `Recebi sua mensagem: "${userText}"`;

    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: replyText },
      }),
    });
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}
