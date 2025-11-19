import { supabase } from "./supabaseClient";

// Tabela: whatsapp_history
// colunas: id (uuid), user_id (text), role (text), content (text), created_at (timestamp)

export async function getHistory(userId) {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from("whatsapp_history")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Erro ao buscar histórico no Supabase:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Erro inesperado ao buscar histórico:", err);
    return [];
  }
}

export async function saveMessage(userId, role, content) {
  if (!supabase) return;

  try {
    const { error } = await supabase.from("whatsapp_history").insert({
      user_id: userId,
      role,
      content,
    });

    if (error) {
      console.error("Erro ao salvar mensagem no Supabase:", error);
    }
  } catch (err) {
    console.error("Erro inesperado ao salvar mensagem:", err);
  }
}
