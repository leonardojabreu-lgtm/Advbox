// app/api/webhook/route.js

// 🔐 Mesmo token configurado na Meta (Configuração → Webhook)
const VERIFY_TOKEN = "leonardo123";

// 🧠 “Banco de dados” simples em memória (enquanto o servidor estiver vivo)
const sessions = {};

/*
  Estrutura da sessão:
  sessions[phone] = {
    stage: 'intro' | 'ask_type' | 'collect_utility' | 'collect_bank' | 'summary' | 'docs' | 'handoff',
    caseType: 'utility' | 'bank' | 'other' | null,
    messages: [{ from: 'client'|'carolina', text: string, ts: number }],
    createdAt: number,
    lastUpdated: number,
    questionsAsked: number
  }
*/

// -----------------------------------------------------
// ✅ GET – validação do Webhook (Meta)
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
// ✅ POST – recebe mensagens do WhatsApp
// -----------------------------------------------------
export async function POST(req) {
  const body = await req.json();
  console.log("POST webhook:", JSON.stringify(body, null, 2));

  try {
    const entry = body.entry?.[0];
    const msg = entry?.changes?.[0]?.value?.messages?.[0];

    // Se não for mensagem de texto, ignora educadamente
    if (!msg || msg.type !== "text") {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const from = msg.from;                // número do cliente (5521...)
    const userText = msg.text.body.trim();

    const token = process.env.WPP_TOKEN;
    const phoneNumberId = process.env.WPP_PHONE_ID;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!token || !phoneNumberId) {
      console.error("Faltando WPP_TOKEN ou WPP_PHONE_ID nas variáveis de ambiente.");
      return new Response("Missing WhatsApp env vars", { status: 500 });
    }

    // Recupera ou cria sessão
    const session = getOrCreateSession(from);

    // Atualiza histórico com a mensagem do cliente
    session.messages.push({
      from: "client",
      text: userText,
      ts: Date.now(),
    });
    session.lastUpdated = Date.now();

    // Detecta/ajusta tipo de caso (apenas heurística)
    if (!session.caseType) {
      session.caseType = inferCaseType(userText);
      if (session.caseType === "utility" && session.stage === "ask_type") {
        session.stage = "collect_utility";
      }
      if (session.caseType === "bank" && session.stage === "ask_type") {
        session.stage = "collect_bank";
      }
    }

    // Gera resposta da Carolina com base no estágio
    const reply = openaiKey
      ? await gerarRespostaCarolina(openaiKey, session, userText)
      : fallbackSemOpenAI(session, userText);

    // Atualiza estágio (máquina de estados simples)
    avançarEstagio(session);

    // Salva resposta no histórico
    session.messages.push({
      from: "carolina",
      text: reply,
      ts: Date.now(),
    });

    // Envia resposta via WhatsApp
    await enviarMensagemWhatsApp(phoneNumberId, token, from, reply);
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
  }

  // A Meta sempre precisa de 200
  return new Response("EVENT_RECEIVED", { status: 200 });
}

// -----------------------------------------------------
// 🧩 Sessão por cliente
// -----------------------------------------------------
function getOrCreateSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = {
      stage: "intro",
      caseType: null,
      messages: [],
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      questionsAsked: 0,
    };
  }
  return sessions[phone];
}

// Heurística simples pra adivinhar tipo de caso
function inferCaseType(text) {
  const t = text.toLowerCase();

  if (
    t.includes("água") ||
    t.includes("aguá") ||
    t.includes("luz") ||
    t.includes("energia") ||
    t.includes("internet") ||
    t.includes("telefone") ||
    t.includes("enel") ||
    t.includes("light") ||
    t.includes("claro") ||
    t.includes("vivo") ||
    t.includes("tim")
  ) {
    return "utility";
  }

  if (
    t.includes("banco") ||
    t.includes("cartão") ||
    t.includes("cartao") ||
    t.includes("crédito") ||
    t.includes("credito") ||
    t.includes("débito") ||
    t.includes("debito") ||
    t.includes("serasa") ||
    t.includes("spc") ||
    t.includes("limite") ||
    t.includes("negativ")
  ) {
    return "bank";
  }

  return "other";
}

// Avança o estágio da conversa
function avançarEstagio(session) {
  const { stage, caseType } = session;
  session.questionsAsked++;

  if (stage === "intro") {
    session.stage = "ask_type";
    return;
  }

  if (stage === "ask_type") {
    if (caseType === "utility") {
      session.stage = "collect_utility";
    } else if (caseType === "bank") {
      session.stage = "collect_bank";
    }
    return;
  }

  // Depois de algumas interações, parte pra resumo/documentos/encerramento
  if (stage === "collect_utility" || stage === "collect_bank") {
    if (session.questionsAsked >= 4) {
      session.stage = "summary";
      return;
    }
  }

  if (stage === "summary") {
    session.stage = "docs";
    return;
  }

  if (stage === "docs") {
    session.stage = "handoff";
    return;
  }

  // handoff: mantém aqui (não reinicia)
}

// -----------------------------------------------------
// 🧠 Carolina + GPT-4o-mini
// -----------------------------------------------------
async function gerarRespostaCarolina(openaiKey, session, userText) {
  const { stage, caseType, messages } = session;

  const historicoCliente = messages
    .filter(m => m.from === "client")
    .map(m => `Cliente: ${m.text}`)
    .join("\n");

  const historicoCarolina = messages
    .filter(m => m.from === "carolina")
    .map(m => `Carolina: ${m.text}`)
    .join("\n");

  const systemPrompt = `
Você é CAROLINA, secretária virtual de um escritório de advocacia em Niterói/RJ.
Especialidades: problemas com água, luz, internet/telefone, bancos e fintechs.
Seu papel é APENAS atendimento inicial, sem opinião jurídica, sem falar em valores de causa.

NUNCA use linguagem jurídica técnica.
NUNCA fale em artigo de lei, jurisprudência ou valores de indenização.
NUNCA diga que o cliente "tem direito" ou que "vai ganhar". Diga sempre que quem avalia é o advogado.

ETAPAS DA CONVERSA (stage atual: ${stage}, tipo de caso: ${caseType || "indefinido"}):

1) "intro"
   - Somente se stage === "intro".
   - Apresente-se uma única vez:
     "Olá, tudo bem? 😊
      Eu sou a Carolina! Nosso escritório é especializado em problemas com água, luz, internet e questões com bancos/fintechs.
      Somos da cidade de Niterói e atendemos em todo o estado do Rio de Janeiro.
      Vou te fazer algumas perguntas rápidas pra entender o que aconteceu e organizar tudo pro advogado responsável analisar o seu caso, combinado?"
   - NÃO repita essa apresentação nos demais estágios.

2) "ask_type"
   - Pergunte de forma direta:
   - "Pra eu te ajudar direitinho: o seu problema é com água, luz, internet/telefone, banco/fintech ou outro tipo de situação?"

3) "collect_utility" (casos de água/luz/internet/telefone)
   - Faça perguntas EM BLOCO, numeradas, sem repetir o texto anterior:
     1️⃣ Nome completo e bairro/cidade.
     2️⃣ Há quanto tempo ficaram/estão sem o serviço ou com problema?
     3️⃣ Na casa mora criança, idoso ou alguém doente?
     4️⃣ Tem protocolos de atendimento da empresa? Peça os números.
     5️⃣ Pergunte sobre prejuízos diretos (perda de alimentos, não conseguir trabalhar, medicamentos etc.).
   - Se o cliente já respondeu algo, NÃO repita a mesma pergunta; complemente com o que faltar.

4) "collect_bank" (casos de banco/fintech)
   - Faça perguntas EM BLOCO, numeradas:
     1️⃣ Nome completo e bairro/cidade.
     2️⃣ Com qual banco ou fintech é o problema?
     3️⃣ O problema é negativação indevida, débito não reconhecido, redução de limite ou outro?
     4️⃣ Desde quando isso está acontecendo?
     5️⃣ Se já tentou resolver direto com o banco. Peça protocolos.
     6️⃣ Pergunte sobre prejuízo direto (compra negada, constrangimento, nome sujo etc.).
   - Não repita perguntas que já foram claramente respondidas.

5) "summary"
   - Faça um RESUMO organizado do caso com base no que o cliente já contou.
   - Exemplo:
     "Entendi, [nome]. Você ficou X dias sem [serviço], em [bairro/cidade], teve [situação especial] e [prejuízos]."
   - Diga que vai organizar tudo pro advogado responsável analisar.

6) "docs"
   - Peça documentos, sempre em tom prático:
     ✔ Foto de documento com foto (RG ou CNH).
     ✔ Foto de conta recente do serviço ou banco.
     ✔ Fotos ou vídeos que mostrem o problema, se tiver.
   - Explique que isso ajuda o advogado a avaliar melhor.

7) "handoff"
   - Agradeça, diga que as informações já foram organizadas e que o advogado ou alguém da equipe vai analisar e responder ali mesmo no WhatsApp.
   - Se o cliente insistir em valores, chances de ganhar etc., repita de forma educada que essa avaliação é exclusiva do advogado.

REGRAS IMPORTANTES:
- Se stage NÃO for "intro", NÃO repita a apresentação completa.
- Nunca mande respostas enormes demais; seja clara e objetiva, mas acolhedora.
- Pode usar emojis com moderação (😊, 🙏, ✅, etc.).
- Se a mensagem do cliente não tiver relação com problema jurídico, responda com cuidado e tente trazer de volta para o contexto de atendimento jurídico.

HISTÓRICO (útil para não repetir coisas):
${historicoCliente ? historicoCliente : "(ainda sem histórico do cliente)"}

RESPOSTAS ANTERIORES DA CAROLINA:
${historicoCarolina || "(nenhuma resposta enviada ainda)"}
`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      max_tokens: 450,
      temperature: 0.35,
    }),
  });

  const data = await response.json();
  console.log("Resposta OpenAI:", JSON.stringify(data, null, 2));

  const content = data?.choices?.[0]?.message?.content;
  return (
    content ||
    "Certo, entendi. Pode me contar um pouco mais do que aconteceu, por favor?"
  );
}

// Fallback se faltar chave da OpenAI
function fallbackSemOpenAI(session, userText) {
  if (session.stage === "intro") {
    return (
      "Olá, tudo bem? 😊 Eu sou a Carolina, do escritório. " +
      "No momento estou sem acesso ao sistema de IA, mas já recebi sua mensagem. " +
      "Você pode me dizer se o problema é com água, luz, internet/telefone, banco/fintech ou outro tipo de situação?"
    );
  }

  return (
    "Recebi a sua mensagem e vou organizar tudo aqui pro advogado responsável analisar, " +
    "tudo bem? Se puder, me conte com detalhes o que aconteceu."
  );
}

// -----------------------------------------------------
// 📤 Envio de mensagem via API oficial do WhatsApp
// -----------------------------------------------------
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
