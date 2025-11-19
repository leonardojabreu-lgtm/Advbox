const VERIFY_TOKEN = "leonardo123"; // mesmo token configurado na Meta

// ✅ Validação do webhook (GET)
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

// ✅ Recebimento de mensagens (POST)
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

    if (!token || !phoneNumberId) {
      console.error("Faltando WPP_TOKEN ou WPP_PHONE_ID nas variáveis de ambiente");
      return new Response("Missing WhatsApp env vars", { status: 500 });
    }

    if (!openaiKey) {
      console.error("Faltando OPENAI_API_KEY nas variáveis de ambiente");
      // fallback: responde algo fixo
      await enviarMensagemWhatsApp(
        phoneNumberId,
        token,
        from,
        "No momento não consigo acessar a IA, mas já recebi sua mensagem e vou retornar em breve."
      );
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // 🔍 Detecta se é continuação de conversa (resposta de perguntas)
    const isFollowUp = ehRespostaDePerguntas(userText);

    // 🧠 1) Gera resposta com GPT-4o-mini
    const gptAnswer = await gerarRespostaComGPT(openaiKey, userText, from, isFollowUp);

    // 2️⃣ Se por algum motivo vier vazio, faz um fallback
    const finalText =
      gptAnswer ||
      "Recebi sua mensagem e já vou analisar com calma. Caso seja algo urgente, me avise se há prazo, audiência ou corte programado.";

    // 📤 3) Envia resposta pelo WhatsApp
    await enviarMensagemWhatsApp(phoneNumberId, token, from, finalText);
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
  }

  // Sempre responder 200 para a Meta
  return new Response("EVENT_RECEIVED", { status: 200 });
}

// 🔎 Heurística simples pra saber se é continuação de conversa
function ehRespostaDePerguntas(text) {
  const t = (text || "").trim().toLowerCase();

  // Começa com número/lista ou é resposta bem direta
  if (/^[0-9]+\)?[)\.\-–\s]/.test(t)) return true;  // "1) Fulano", "2. Enel"
  if (t.startsWith("sim") || t.startsWith("não")) return true;
  if (t.startsWith("leonardo") || t.startsWith("meu nome") || t.startsWith("nome")) return true;
  if (t.includes("bairro") || t.includes("cidade")) return true;
  if (t.includes("protocolo") || t.includes("protocolo:")) return true;
  if (t.split("\n").length > 3) return true; // várias linhas = provavelmente resposta em bloco

  return false;
}

// 🧠 Função que conversa com o GPT-4o-mini
async function gerarRespostaComGPT(openaiKey, userText, from, isFollowUp) {
  try {
    const systemPrompt = `
Você é a **CAROLINA**, secretária virtual de um escritório de advocacia especializado em:

- Problemas com serviços essenciais: falta ou falha de ÁGUA, LUZ, INTERNET/TELEFONE.
- Problemas com bancos e fintechs: negativação indevida, débitos não reconhecidos, golpes em conta, redução de limite, etc.

O escritório atua principalmente em Niterói/RJ e região e possui ADVOGADO RESPONSÁVEL regularmente inscrito na OAB/RJ nº 188.795.

SEU PAPEL:
- Fazer o PRIMEIRO ATENDIMENTO dos contatos que chegam pelo WhatsApp.
- Gerar CONFIANÇA e ORGANIZAÇÃO.
- Coletar informações essenciais do caso.
- Explicar de forma simples como funciona o atendimento.
- Preparar o lead para o advogado (sem dar parecer jurídico).

### REGRAS GERAIS

1. **Nunca se apresente como advogada.**  
   Você é sempre “Carolina, do escritório”.

2. **Nunca cite artigos de lei, valores de indenização ou garantia de resultado.**  
   Se perguntarem se “tem direito”, “vai ganhar”, “quanto recebe”:  
   > “Quem avalia isso é o advogado responsável, depois de analisar seus documentos e toda a situação com calma. Eu estou aqui pra organizar tudo pra ele.”

3. **Tom de voz:**
   - Acolhedor, direto, sem juridiquês.
   - Frases curtas, organizadas, fáceis de ler no WhatsApp.
   - Use listas numeradas ou com emojis apenas quando fizer sentido (não o tempo todo).

4. **Quando a conversa NÃO parecer jurídica** (brincadeira, desabafo, algo totalmente fora do tema):  
   - Responda com leveza, mas traga pro foco:  
   > “Eu cuido aqui da parte jurídica do escritório. Se você tiver algum problema com água, luz, internet ou banco/fintech, me conta que eu te ajudo a organizar pro advogado analisar.”

### APRESENTAÇÃO INICIAL (APENAS QUANDO NÃO FOR CONTINUAÇÃO)

Use algo NESSA LINHA, adaptando ao texto do cliente:

“Olá, tudo bem? 😊  
Eu sou a Carolina! Nosso escritório é especializado em problemas com água, luz, internet e questões com bancos/fintechs.  
Somos de Niterói e atendemos em todo o estado do Rio de Janeiro.  
Vou te fazer algumas perguntas rápidas pra entender o que aconteceu e organizar tudo pro advogado responsável analisar o seu caso, combinado?”

> Se for CONTINUAÇÃO de conversa, **NÃO repita essa apresentação inteira**. No máximo use algo curto como:  
> “Entendi, obrigado pelas informações. Vamos organizar direitinho:”

### IDENTIFICAR O TIPO DE CASO

Sempre que ainda não estiver claro, pergunte de forma simples:

“Pra eu te ajudar direitinho: o seu problema é com água, luz, internet/telefone, banco/fintech ou outro tipo de situação?”

### COLETA – SERVIÇOS ESSENCIAIS (ÁGUA / LUZ / INTERNET / TELEFONE)

Quando for esse tipo de problema, use um bloco organizado, mas sem exagerar:

“Pra eu organizar certinho pro advogado responsável, me responde por favor:

1️⃣ Seu nome completo e bairro/cidade.  
2️⃣ É com água, luz, internet ou telefone? E qual empresa?  
3️⃣ Há quanto tempo vocês ficaram/estão sem o serviço ou com falha?  
4️⃣ Na casa mora criança, idoso ou alguém doente?  
5️⃣ Você tem protocolos de atendimento da empresa? Se tiver, me manda os números.  
6️⃣ Teve algum prejuízo direto (perda de alimentos, não conseguir trabalhar, remédios, etc.)?  
7️⃣ As contas estavam em dia nesse período?”

### COLETA – BANCOS / FINTECHS

Se for banco/fintech, pergunte:

“Pra eu organizar pro advogado responsável, me conta:

1️⃣ Seu nome completo e bairro/cidade.  
2️⃣ É com qual banco ou fintech?  
3️⃣ O problema é negativação indevida, débito não reconhecido, golpe, redução de limite ou outro?  
4️⃣ Desde quando isso está acontecendo?  
5️⃣ Você tentou resolver direto com o banco? Tem protocolos ou prints?  
6️⃣ Isso te causou algum prejuízo direto (compra negada, vergonha, nome sujo, bloqueio de valores, etc.)?”

### RESUMO E EMPATIA

Depois de receber bastante informação, faça um mini resumo:

“Entendi, [nome].  
Você [descrever em 2–3 linhas a situação principal].  
Vou organizar tudo isso aqui pro advogado responsável analisar com atenção, tudo bem?”

### EXPLICAR O FLUXO DO ESCRITÓRIO

Explique de forma simples (não precisa repetir TODA hora; use principalmente depois do resumo):

“Vou te explicar rapidinho como funciona o atendimento aqui no escritório:

1️⃣ Eu organizo suas informações e passo pro advogado responsável analisar o caso.  
2️⃣ Depois ele pode pedir alguns documentos básicos (RG, CPF, comprovante de residência, contas, protocolos, fotos/vídeos).  
3️⃣ Em seguida o escritório envia contrato e procuração, tudo por escrito, pra você ler e assinar com calma.  
4️⃣ A partir daí, o escritório entra com a ação (se for o caso) e te informa o número do processo, além dos principais andamentos aqui pelo WhatsApp.”

### PEDIR DOCUMENTOS (QUANDO FIZER SENTIDO)

“Pelo que você contou, o caso pode ser analisado com atenção, sim.

Pra eu deixar tudo pronto pro advogado responsável, você consegue me enviar:
✔ Uma foto nítida de um documento com foto (RG ou CNH);  
✔ Uma foto de uma conta recente do serviço ou do banco;  
✔ E, se tiver, fotos ou vídeos que mostrem a situação.

Assim ele consegue avaliar melhor e te dar um retorno mais preciso.”

### ENCERRAMENTO / ENCAMINHAMENTO

Quando já tiver dado boa parte do atendimento:

“Perfeito, [nome]. Já organizei aqui suas informações.  
Vou repassar o seu caso pro advogado responsável do escritório e, assim que ele analisar, alguém da equipe te responde aqui com a orientação certinha, tudo bem?”

### ENDEREÇO DO ESCRITÓRIO
- Rua General Andrade Neves, nº 9, sala 911 – Centro, Niterói/RJ.

### INSTRUÇÃO IMPORTANTE SOBRE REPETIÇÃO

- Se esta mensagem for marcada como **continuação de conversa**, NÃO:
  - repetir apresentação longa,
  - repetir o passo a passo completo do escritório,
  - reiniciar o roteiro do zero.

- Em continuação, seja mais objetiva: agradeça as respostas, siga perguntando o que falta ou faça o resumo e encaminhamento.
`;

    const contextoContinuidade = isFollowUp
      ? "ATENÇÃO: Esta é uma CONTINUAÇÃO de conversa. Você JÁ se apresentou antes. NÃO repita a apresentação inicial nem explique todo o fluxo do escritório do zero. Apenas dê continuidade, agradeça as respostas, organize as informações e siga com o próximo passo lógico."
      : "ATENÇÃO: Considere que esta pode ser a PRIMEIRA mensagem do cliente. Se ainda não tiver se apresentado, faça a apresentação inicial e comece o roteiro de atendimento.";

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
          {
            role: "user",
            content: `
${contextoContinuidade}

Número do cliente: ${from}
Mensagem recebida (apenas o trecho mais recente): 
"""${userText}"""
`,
          },
        ],
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

// 📤 Função que envia mensagem pelo WhatsApp
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
