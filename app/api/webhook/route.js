// app/api/webhook/route.js
import { getHistory, saveMessage } from "../../internal/memory";
import { buildSystemPrompt } from "../../internal/rules";
import { runLegalAnalysis } from "../../internal/legalAgent";

const VERIFY_TOKEN = "leonardo123"; // mesmo usado na Meta

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

    const from = message.from;                 // número do cliente
    const userText = message.text?.body || ""; // texto enviado

    const wppToken = process.env.WPP_TOKEN;
    const phoneNumberId = process.env.WPP_PHONE_ID;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!wppToken || !phoneNumberId) {
      console.error("Faltando WPP_TOKEN ou WPP_PHONE_ID");
      return new Response("Missing WhatsApp env vars", { status: 500 });
    }

    if (!openaiKey) {
      console.error("Faltando OPENAI_API_KEY");
      await enviarMensagemWhatsApp(
        phoneNumberId,
        wppToken,
        from,
        "No momento não consigo acessar a IA, mas já recebi sua mensagem e vou retornar em breve."
      );
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // 2.1) Busca histórico no Supabase
    const history = await getHistory(from); // [{role, content, created_at}]

    // Segurança: se já está MUITO longo, encerra e manda para o advogado
    if (history.length >= 40) {
      const encerramento =
        "Perfeito, já tenho bastante informação sobre o seu caso aqui.\n" +
        "Agora vou repassar tudo para o advogado responsável do escritório analisar com calma, " +
        "e assim que ele verificar, alguém da equipe te responde aqui com a orientação certinha, tudo bem?";

      await saveMessage(from, "assistant", encerramento);
      await enviarMensagemWhatsApp(phoneNumberId, wppToken, from, encerramento);

      // dispara análise jurídica em background
      ;(async () => {
        try {
          const fullHistory = await getHistory(from);
          await runLegalAnalysis(openaiKey, from, fullHistory);
        } catch (err) {
          console.error("Erro na análise jurídica background:", err);
        }
      })();

      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // 2.2) Monta contexto para Carolina
    const systemPrompt = buildSystemPrompt();

    const mensagensPassadas = history
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const mensagensParaGPT = [
      { role: "system", content: systemPrompt },
      ...mensagensPassadas,
      { role: "user", content: `Mensagem do cliente (${from}): ${userText}` },
    ];

    // 2.3) Chama GPT-4o mini
    const respostaCarolina = await callOpenAIChat(openaiKey, mensagensParaGPT);
    const finalText =
      respostaCarolina ||
      "Recebi sua mensagem e já vou analisar com calma. Caso seja algo urgente, me conta se há prazo ou audiência próxima.";

    // 2.4) Bloqueio de resposta duplicada
    const ultimaResposta = history.filter((h) => h.role === "assistant").at(-1);
    if (ultimaResposta && ultimaResposta.content?.trim() === finalText.trim()) {
      console.log("Resposta igual à anterior, ajustando texto.");
      const ajustada =
        finalText +
        "\n\n(Atualizei aqui pra não te mandar a mesma mensagem duas vezes seguidas 😊)";
      await saveMessage(from, "user", userText);
      await saveMessage(from, "assistant", ajustada);
      await enviarMensagemWhatsApp(phoneNumberId, wppToken, from, ajustada);
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // 2.5) Salva histórico
    await saveMessage(from, "user", userText);
    await saveMessage(from, "assistant", finalText);

    // 2.6) Dispara análise jurídica + CRM em background (se quiser)
    ;(async () => {
      try {
        const fullHistory = await getHistory(from);
        await runLegalAnalysis(openaiKey, from, fullHistory);
        // aqui depois podemos chamar upsertLeadFromAnalysis(...)
      } catch (err) {
        console.error("Erro no pipeline jurídico/CRM:", err);
      }
    })();

    // 2.7) Responde pelo WhatsApp
    await enviarMensagemWhatsApp(phoneNumberId, wppToken, from, finalText);
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

// ========== 3) Chamada genérica ao GPT-4o mini ==========
async function callOpenAIChat(openaiKey, messages) {
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 500,
        temperature: 0.4,
      }),
    });

    const data = await resp.json();
    console.log("Resposta da OpenAI (Carolina):", JSON.stringify(data, null, 2));

    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("Erro ao chamar OpenAI:", err);
    return null;
  }
}

// ========== 4) Enviar mensagem pelo WhatsApp ==========
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
