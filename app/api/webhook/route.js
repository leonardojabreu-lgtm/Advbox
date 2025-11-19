import { getHistory, saveMessage } from "../../internal/memory";
import { buildSystemPrompt } from "../../internal/rules";
import { runLegalAnalysis } from "../../internal/legalAgent";
import { upsertLeadFromAnalysis } from "../../internal/crmConnector";

const VERIFY_TOKEN = "leonardo123"; // mesmo token configurado na Meta

// ========== 1) VERIFICAÇÃO DO WEBHOOK (GET) ==========
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

// ========== 2) RECEBIMENTO DE MENSAGENS (POST) ==========
export async function POST(req) {
  const body = await req.json();
  console.log("POST webhook:", JSON.stringify(body, null, 2));

  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const message = messages[0];

    if (message.type !== "text") {
      console.log("Mensagem não é de texto, ignorando.");
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const from = message.from;                 // número do cliente (ex: 5521...)
    const userText = message.text?.body || ""; // texto enviado pelo cliente

    const wppToken = process.env.WPP_TOKEN;
    const phoneNumberId = process.env.WPP_PHONE_ID;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!wppToken || !phoneNumberId) {
      console.error("Faltando WPP_TOKEN ou WPP_PHONE_ID nas variáveis de ambiente");
      return new Response("Missing WhatsApp env vars", { status: 500 });
    }

    if (!openaiKey) {
      console.error("Faltando OPENAI_API_KEY nas variáveis de ambiente");
      await enviarMensagemWhatsApp(
        phoneNumberId,
        wppToken,
        from,
        "No momento não consigo acessar a IA, mas já recebi sua mensagem e vou retornar em breve."
      );
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // ========== 2.1) BUSCA HISTÓRICO NO SUPABASE ==========
    const history = await getHistory(from); // [{role, content, created_at}, ...]

    // Limite de segurança: se já tem muita interação, encerra e manda pro advogado
    if (history.length >= 30) {
      const encerramento =
        "Perfeito, já tenho bastante informação sobre o seu caso aqui.\n" +
        "Agora vou repassar tudo para o advogado responsável do escritório analisar com calma, " +
        "e assim que ele verificar, alguém da equipe te responde aqui com a orientação certinha, tudo bem?";

      await saveMessage(from, "assistant", encerramento);
      await enviarMensagemWhatsApp(phoneNumberId, wppToken, from, encerramento);

      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // ========== 2.2) MONTA CONTEXTO PARA A CAROLINA ==========
    const systemPrompt = buildSystemPrompt();

    const mensagensPassadas = history
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const messagesForGPT = [
      { role: "system", content: systemPrompt },
      ...mensagensPassadas,
      { role: "user", content: `Mensagem do cliente (${from}): ${userText}` },
    ];

    // ========== 2.3) CHAMA GPT-4o (CAROLINA) ==========
    const respostaCarolina = await callOpenAIChat(openaiKey, messagesForGPT);
    const finalText =
      respostaCarolina ||
      "Recebi sua mensagem e já vou analisar com calma. Caso seja algo urgente, me conta se há prazo ou audiência próxima.";

    // ========== 2.4) BLOQUEIO DE RESPOSTA DUPLICADA ==========
    const ultimaResposta = history.filter((h) => h.role === "assistant").at(-1);
    if (ultimaResposta && ultimaResposta.content?.trim() === finalText.trim()) {
      console.log("Resposta seria igual à anterior, ajustando texto para evitar repetição.");
      // pequeno ajuste
      const ajustada =
        finalText +
        "\n\n(Atualizei aqui pra não te mandar a mesma mensagem duas vezes seguidas 😊)";
      await saveMessage(from, "user", userText);
      await saveMessage(from, "assistant", ajustada);
      await enviarMensagemWhatsApp(phoneNumberId, wppToken, from, ajustada);
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // ========== 2.5) SALVA HISTÓRICO ==========
    await saveMessage(from, "user", userText);
    await saveMessage(from, "assistant", finalText);

    // ========== 2.6) DISPARA ANÁLISE JURÍDICA + CRM (ASSÍNCRONO) ==========
    // Não precisamos travar a resposta do cliente nisso, então rodamos em "background"
    ;(async () => {
      try {
        const fullHistory = await getHistory(from);
        const analysis = await runLegalAnalysis(openaiKey, from, fullHistory);
        if (analysis) {
          await upsertLeadFromAnalysis(from, analysis);
        }
      } catch (err) {
        console.error("Erro no pipeline jurídico/CRM:", err);
      }
    })();

    // ========== 2.7) RESPONDE PELO WHATSAPP ==========
    await enviarMensagemWhatsApp(phoneNumberId, wppToken, from, finalText);
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

// ========== 3) CHAMADA GENÉRICA AO GPT-4o ==========
async function callOpenAIChat(openaiKey, messages) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        max_tokens: 500,
        temperature: 0.4,
      }),
    });

    const data = await response.json();
    console.log("Resposta da OpenAI (Carolina):", JSON.stringify(data, null, 2));

    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("Erro ao chamar OpenAI:", err);
    return null;
  }
}

// ========== 4) ENVIAR MENSAGEM PELO WHATSAPP ==========
async function enviarMensagemWhatsApp(phoneNumberId, token, to, text) {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  const data = await resp.json();
  console.log("Resposta da API do WhatsApp:", resp.status, JSON.stringify(data, null, 2));

  if (!resp.ok) {
    console.error("Erro ao enviar mensagem pelo WhatsApp:", data);
  }
}
