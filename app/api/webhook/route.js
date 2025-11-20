import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- CONFIGURAÇÃO ---
// Inicializa o Gemini com a sua API KEY
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// IMPORTANTE: Usamos o 'gemini-1.5-flash' pois é mais rápido e evita o erro 404 do 'pro' antigo
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  systemInstruction: "Você é um assistente útil e amigável no WhatsApp." // Opcional: define a personalidade
});

// --- FUNÇÃO GET (Verificação do Webhook pela Meta) ---
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  // Verifica se o token bate com o que você definiu no .env
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verificado com sucesso!");
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse('Falha na verificação. Token inválido.', { status: 403 });
}

// --- FUNÇÃO POST (Recebimento das Mensagens) ---
export async function POST(req) {
  try {
    const body = await req.json();

    // Log para debug na Vercel (ajuda a ver o que está chegando)
    // console.log("Payload recebido:", JSON.stringify(body, null, 2));

    // Navega no objeto JSON complexo do WhatsApp para achar a mensagem
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    // Se não houver mensagem (ex: status de leitura, digitando, etc), retornamos 200 para não travar
    if (!messages || messages.length === 0) {
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    }

    // Pega a primeira mensagem e o número de quem enviou
    const message = messages[0];
    const senderPhone = message.from; // Número do usuário (ex: 5511999999999)
    const messageType = message.type;

    // Verifica se é uma mensagem de texto
    if (messageType === 'text') {
      const userText = message.text.body;
      
      console.log(`Mensagem de ${senderPhone}: ${userText}`);

      // 1. Gera a resposta com o Gemini
      const chatResponse = await model.generateContent(userText);
      const aiResponse = chatResponse.response.text();

      // 2. Envia a resposta de volta para o WhatsApp
      await sendWhatsAppMessage(senderPhone, aiResponse);
    }

    // Retorna 200 OK para o WhatsApp saber que recebemos (obrigatório)
    return new NextResponse('EVENT_RECEIVED', { status: 200 });

  } catch (error) {
    console.error("Erro no processamento:", error);
    // Mesmo com erro, é boa prática retornar 200 para o WhatsApp não ficar tentando reenviar o webhook infinitamente
    return new NextResponse('Internal Server Error', { status: 200 });
  }
}

// --- FUNÇÃO AUXILIAR: Enviar mensagem para API do WhatsApp ---
async function sendWhatsAppMessage(to, text) {
  const version = 'v20.0'; // Ou v21.0, verifique na sua dashboard
  const phoneNumberId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_API_TOKEN;

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "text",
    text: { body: text }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Erro ao enviar mensagem no WhatsApp:", JSON.stringify(errorData, null, 2));
  }
}
