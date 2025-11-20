// app/api/webhook/route.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ====== Função para enviar mensagem pelo WhatsApp Cloud API ======
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Erro ao enviar mensagem WhatsApp:", res.status, errText);
  }
}

// ====== Handler GET (verificação do webhook do Meta) ======
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// ====== Handler POST (mensagem recebida) ======
export async function POST(req) {
  try {
    const body = await req.json();

    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    // Se não for mensagem de texto, só confirma pro Meta
    if (!message || message.type !== "text") {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const from = message.from; // número do cliente (ex: 55219...)
    const userText = message.text?.body || "";

    // ====== Chamada ao Gemini ======
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt =
      "Você é uma secretária virtual de um escritório de advocacia. " +
      "Responda de forma educada, clara e objetiva, sempre pedindo mais informações " +
      "se necessário. Não prometa resultado e não fale como se fosse o advogado. " +
      "Mensagem do cliente: " +
      userText;

    const result = await model.generateContent(prompt);
    const reply = result.response.text();

    // ====== Responder pelo WhatsApp ======
    await sendWhatsAppMessage(from, reply);

    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("Erro no webhook:", error);
    // Mensagem de fallback simples
    // (se a IA quebrar, o usuário pelo menos recebe algo)
    // ⚠️ se quiser, pode remover essa linha
    // await sendWhatsAppMessage(from, "No momento não consigo acessar a IA, tente novamente em alguns minutos.");

    return new Response("ERROR", { status: 200 });
  }
}
