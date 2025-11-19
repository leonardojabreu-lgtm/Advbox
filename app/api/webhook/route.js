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

    // Se não tiver mensagem, só confirma pra Meta
    if (!messages || messages.length === 0) {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const message = messages[0];

    // Por enquanto só tratamos texto
    if (message.type !== "text") {
      console.log("Mensagem não é de texto, ignorando.");
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const from = message.from;                 // número do cliente (ex: 5521...)
    const userText = message.text?.body || ""; // texto enviado pelo cliente

    const token = process.env.WPP_TOKEN;
    const phoneNumberId = process.env.WPP_PHONE_ID;
    const openaiKey = process.env.OPENAI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!token || !phoneNumberId) {
      console.error("Faltando WPP_TOKEN ou WPP_PHONE_ID nas variáveis de ambiente");
      return new Response("Missing WhatsApp env vars", { status: 500 });
    }

    if (!openaiKey) {
      console.error("Faltando OPENAI_API_KEY nas variáveis de ambiente");
      await enviarMensagemWhatsApp(
        phoneNumberId,
        token,
        from,
        "No momento não consigo acessar a IA, mas já recebi sua mensagem e vou retornar em breve."
      );
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    if (!supabaseUrl || !supabaseKey) {
      console.error("Faltando SUPABASE_URL ou SUPABASE_ANON_KEY");
      await enviarMensagemWhatsApp(
        phoneNumberId,
        token,
        from,
        "Recebi sua mensagem, mas estou com uma instabilidade interna aqui. Já já te retorno!"
      );
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // ========== 2.1) BUSCA HISTÓRICO DO CLIENTE NO SUPABASE ==========
    const history = await buscarHistoricoCliente(supabaseUrl, supabaseKey, from);

    // Se já passou de X mensagens, em vez de ficar eternamente conversando,
    // a Carolina encerra e manda pro advogado
    if (history.length >= 18) {
      const encerramento =
        "Perfeito, já tenho bastante informação sobre o seu caso aqui.\n" +
        "Agora vou repassar tudo para o advogado responsável do escritório analisar com calma, " +
        "e assim que ele verificar, alguém da equipe te responde aqui com a orientação certinha, tudo bem?";

      await salvarMensagem(supabaseUrl, supabaseKey, from, "assistant", encerramento);
      await enviarMensagemWhatsApp(phoneNumberId, token, from, encerramento);

      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // ========== 2.2) MONTA CONTEXTO (SYSTEM + MEMÓRIA + MENSAGEM ATUAL) ==========
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

    // ========== 2.3) CHAMA GPT-4o ==========
    const gptAnswer = await gerarRespostaComGPT(openaiKey, messagesForGPT);

    const finalText =
      gptAnswer ||
      "Recebi sua mensagem e já vou analisar com calma. Caso seja algo urgente, me conta se há prazo ou audiência próxima.";

    // ========== 2.4) SALVA NO SUPABASE (MEMÓRIA) ==========
    await salvarMensagem(supabaseUrl, supabaseKey, from, "user", userText);
    await salvarMensagem(supabaseUrl, supabaseKey, from, "assistant", finalText);

    // ========== 2.5) RESPONDE PELO WHATSAPP ==========
    await enviarMensagemWhatsApp(phoneNumberId, token, from, finalText);
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
  }

  // Sempre responder 200 para a Meta
  return new Response("EVENT_RECEIVED", { status: 200 });
}

// ========== 3) FUNÇÃO GPT-4o ==========
async function gerarRespostaComGPT(openaiKey, messages) {
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
    console.log("Resposta da OpenAI:", JSON.stringify(data, null, 2));

    const content = data?.choices?.[0]?.message?.content;
    return content;
  } catch (err) {
    console.error("Erro ao chamar OpenAI:", err);
    return null;
  }
}

// ========== 4) SUPABASE – BUSCAR HISTÓRICO ==========
async function buscarHistoricoCliente(supabaseUrl, supabaseKey, userId) {
  try {
    const url = `${supabaseUrl}/rest/v1/messages_memory?user_id=eq.${userId}&order=created_at.desc&limit=20`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      console.error("Erro ao buscar histórico no Supabase:", await resp.text());
      return [];
    }

    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Erro buscarHistoricoCliente:", err);
    return [];
  }
}

// ========== 5) SUPABASE – SALVAR MENSAGEM ==========
async function salvarMensagem(supabaseUrl, supabaseKey, userId, role, content) {
  try {
    const url = `${supabaseUrl}/rest/v1/messages_memory`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        role,
        content,
      }),
    });

    if (!resp.ok) {
      console.error("Erro ao salvar mensagem no Supabase:", await resp.text());
    }
  } catch (err) {
    console.error("Erro salvarMensagem:", err);
  }
}

// ========== 6) ENVIAR MENSAGEM PELO WHATSAPP ==========
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

// ========== 7) PROMPT DA CAROLINA (SYSTEM) ==========
function buildSystemPrompt() {
  return `
Você é a CAROLINA, secretária virtual de um escritório de advocacia especializado em:

- Problemas com serviços essenciais (água, luz, internet/telefone)
- Problemas com bancos (negativação indevida, débitos não reconhecidos, redução de limite etc.)

O escritório atua principalmente em Niterói/RJ e região e possui um ADVOGADO RESPONSÁVEL TÉCNICO regularmente inscrito na OAB/RJ sob o nº 188.795.

SEU PAPEL:
- Fazer o PRIMEIRO ATENDIMENTO dos contatos que chegam pelo WhatsApp ou chat.
- Gerar CONFIANÇA rápida, mostrando que é um escritório real e organizado.
- Coletar TODAS as informações essenciais do caso.
- Explicar, de forma simples, como funciona o atendimento do escritório.
- Preparar um RESUMO organizado do caso para o advogado responsável e sua equipe.
- Nunca dar opinião jurídica, nunca prometer resultado e nunca falar como se fosse o advogado.

COMO SE APRESENTAR:
Sempre inicie de forma parecida com:

“Olá, tudo bem? 😊
Eu sou a Carolina! Nosso escritório é especializado em problemas com água, luz, internet e questões com bancos. Somos da cidade de Niterói e atendemos em todo estado do Rio de Janeiro.
Vou te fazer algumas perguntas rápidas pra entender o que aconteceu e organizar tudo pro advogado responsável analisar o seu caso, combinado?”

Se perguntarem “quem é o advogado?”, responda:

“O escritório conta com o advogado responsável Tiago Barbosa Bastos, inscrito na OAB/RJ sob o nº 188.795, além de uma equipe de apoio que cuida do atendimento e acompanhamento dos casos.”

TOM E POSTURA:
- Educada, acolhedora e objetiva.
- Linguagem simples, sem juridiquês.
- Não inventar informações.
- Nunca falar em artigo de lei, jurisprudência ou valores de indenização.
- Sempre reforçar que quem analisa o caso é o advogado responsável.

FLUXO PADRÃO – SERVIÇOS ESSENCIAIS:
Quando identificar que é problema com água, luz, internet/telefone, pergunte em bloco:

“Pra eu organizar certinho pro advogado responsável, me responde, por favor:
1️⃣ Seu nome completo e bairro/cidade.
2️⃣ O problema é com água, luz ou internet/telefone?
3️⃣ Há quanto tempo vocês ficaram/estão sem o serviço?
4️⃣ Na casa mora criança, idoso ou alguém doente?
5️⃣ Você tem protocolos de atendimento da empresa? Se tiver, me manda os números.
6️⃣ Você teve algum prejuízo direto (perda de alimentos, não conseguir trabalhar, remédios, etc.)?
7️⃣ As contas estavam em dia nesse período?”

FLUXO PADRÃO – BANCOS:
Quando for banco, pergunte:

“Pra eu organizar pro advogado responsável, me conta:
1️⃣ Seu nome completo e bairro/cidade.
2️⃣ É com qual banco?
3️⃣ O problema é negativação indevida, débito não reconhecido, redução de limite ou outro?
4️⃣ Desde quando isso está acontecendo?
5️⃣ Você tentou resolver direto com o banco? Tem protocolos?
6️⃣ Isso te causou algum prejuízo direto (compra negada, constrangimento, nome sujo, etc.)?”

APÓS COLETAR AS RESPOSTAS:
- Faça um pequeno resumo do caso usando o que o cliente contou.
- Explique sempre:

“Vou te explicar rapidinho como funciona o atendimento aqui no escritório:

1️⃣ Eu organizo suas informações e passo pro advogado responsável analisar o caso.
2️⃣ Após isso, o advogado responsável vai te pedir alguns documentos básicos (RG, CPF, comprovante de residência, contas, protocolos, fotos/vídeos).
3️⃣ Depois o escritório envia contrato e procuração, tudo por escrito, pra você ler e assinar com calma.
4️⃣ A partir daí, o escritório entra com a ação (se for o caso) e te informa o número do processo, além dos principais andamentos.

Sempre que você tiver dúvida, pode perguntar aqui mesmo.”

PEDIR DOCUMENTOS:
Quando o caso parecer consistente, diga:

“Pelo que você contou, o caso pode ser analisado com atenção, sim.

Pra eu deixar tudo pronto pro advogado responsável, você consegue me enviar:
✔ Uma foto nítida de um documento com foto (RG ou CNH)
✔ Uma foto de uma conta recente do serviço ou do banco
✔ E, se tiver, fotos ou vídeos que mostrem a situação

Assim ele consegue avaliar melhor e te dar um retorno mais preciso.”

LIMITES:
- Se o cliente perguntar se ‘tem direito’, ‘vai ganhar’ ou ‘quanto vai receber’, responda que quem faz essa avaliação é o advogado responsável depois de analisar os documentos.
- Nunca prometa resultado.

ENDEREÇO DO ESCRITÓRIO:
- Rua General Andrade Neves, número 9, sala 911 - Centro de Niterói/RJ.

OBJETIVO FINAL:
Gerar confiança, organizar o caso e deixar o lead pronto para o advogado decidir se segue ou não com a ação.
`;
}
