import { getHistory, saveMessage } from "../../internal/memory";
import { buildSystemPrompt } from "../../internal/rules";
import { runLegalAnalysis } from "../../internal/legalAgent";
import { upsertLeadFromAnalysis } from "../../internal/crmConnector";

const VERIFY_TOKEN = "leonardo123";

// =======================
// 1) GET - VERIFICAÇÃO META
// =======================
export async function GET(req) {
  const { searchParams } = new URL(req.url);

  if (
    searchParams.get("hub.mode") === "subscribe" &&
    searchParams.get("hub.verify_token") === VERIFY_TOKEN
  ) {
    return new Response(searchParams.get("hub.challenge"), { status: 200 });
  }

  return new Response("Erro de verificação", { status: 403 });
}

// =======================
// 2) POST - RECEBIMENTO WHATSAPP
// =======================
export async function POST(req) {
  const body = await req.json();
  console.log("Webhook recebido:", JSON.stringify(body, null, 2));

  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg || msg.type !== "text") {
      return new Response("OK", { status: 200 });
    }

    const from = msg.from;
    const text = msg.text?.body || "";

    const WPP_TOKEN = process.env.WPP_TOKEN;
    const WPP_PHONE_ID = process.env.WPP_PHONE_ID;
    const OPENAI_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_KEY) {
      await sendWpp(WPP_PHONE_ID, WPP_TOKEN, from,
        "No momento não consigo acessar a IA, mas já recebi sua mensagem e vou retornar em breve."
      );
      return new Response("OK", { status: 200 });
    }

    // HISTÓRICO
    const history = await getHistory(from);

    if (history.length >= 30) {
      const encerramento =
        "Muito obrigado! Eu já tenho todas as informações importantes do seu caso. Agora vou repassar tudo para o advogado analisar com cuidado, e ele te responde aqui mesmo.";
      await saveMessage(from, "assistant", encerramento);
      await sendWpp(WPP_PHONE_ID, WPP_TOKEN, from, encerramento);
      return new Response("OK", { status: 200 });
    }

    // SYSTEM CONTEXT
    const systemPrompt = buildSystemPrompt();

    // MENSAGENS
    const pastMessages = history
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const messagesForAI = [
      { role: "system", content: systemPrompt },
      ...pastMessages,
      { role: "user", content: `Cliente (${from}): ${text}` },
    ];

    // GPT-4o
    const resposta = await callOpenAIChat(OPENAI_KEY, messagesForAI);
    const finalText =
      resposta ||
      "Recebi sua mensagem e já vou analisar para te ajudar da melhor forma possível.";

    // EVITAR REPETIÇÃO
    const lastBot = history.filter((m) => m.role === "assistant").at(-1);
    if (lastBot && lastBot.content.trim() === finalText.trim()) {
      const ajustada =
        finalText +
        "\n\n(Atualizei aqui só para não te mandar a mesma mensagem novamente 😊)";
      await saveMessage(from, "assistant", ajustada);
      await sendWpp(WPP_PHONE_ID, WPP_TOKEN, from, ajustada);
      return new Response("OK", { status: 200 });
    }

    // SALVAR
    await saveMessage(from, "user", text);
    await saveMessage(from, "assistant", finalText);

    // RODAR ANÁLISE JURÍDICA — ASSÍNCRONA
    (async () => {
      try {
        const fullHistory = await getHistory(from);
        const analysis = await runLegalAnalysis(OPENAI_KEY, from, fullHistory);
        if (analysis) await upsertLeadFromAnalysis(from, analysis);
      } catch (err) {
        console.error("Erro no pipeline jurídico:", err);
      }
    })();

    // ENVIAR RESPOSTA
    await sendWpp(WPP_PHONE_ID, WPP_TOKEN, from, finalText);
  } catch (err) {
    console.error("Erro:", err);
  }

  return new Response("OK", { status: 200 });
}

// =======================
// FUNÇÃO GPT
// =======================
async function callOpenAIChat(key, messages) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    const data = await res.json();
    console.log("Resposta OpenAI:", JSON.stringify(data, null, 2));

    return data?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error("Erro GPT:", e);
    return null;
  }
}

// =======================
// FUNÇÃO WHATSAPP
// =======================
async function sendWpp(phoneId, token, to, text) {
  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

  const r = await fetch(url, {
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

  const data = await r.json();
  console.log("WPP resposta:", r.status, JSON.stringify(data));

  return data;
}
