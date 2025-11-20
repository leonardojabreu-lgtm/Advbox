import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export async function POST(req) {
  try {
    const body = await req.json();

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const result = await model.generateContent([
      { role: "user", parts: [{ text: body.message }] }
    ]);

    const text = result.response.text();

    return new Response(JSON.stringify({ reply: text }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Erro Gemini:", err);
    return new Response(
      JSON.stringify({ error: "IA indisponível no momento" }),
      { status: 500 }
    );
  }
}
