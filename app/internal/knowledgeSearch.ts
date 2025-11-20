import { supabase } from "./supabaseClient";
import OpenAI from "openai";

export async function searchKnowledge(openaiKey: string, query: string) {
  try {
    const openai = new OpenAI({ apiKey: openaiKey });

    // 1) Criar embedding da pergunta do cliente
    const embed = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });

    const vector = embed.data[0].embedding;

    // 2) Buscar na tabela knowledge_base usando match vetorial
    const { data, error } = await supabase.rpc("match_knowledge", {
      query_embedding: vector,
      match_threshold: 0.55,
      match_count: 3
    });

    if (error) {
      console.error("Erro no match_knowledge:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Erro no searchKnowledge:", err);
    return [];
  }
}
