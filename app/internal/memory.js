import { supabase } from "./supabaseClient";

export async function getHistory(userId: string) {
  try {
    const { data, error } = await supabase
      .from("whatsapp_history")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Erro ao buscar histórico:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Erro inesperado:", err);
    return [];
  }
}

export async function saveMessage(userId: string, role: "user" | "assistant", content: string) {
  try {
    const { error } = await supabase.from("whatsapp_history").insert({
      user_id: userId,
      role,
      content,
    });

    if (error) {
      console.error("Erro ao salvar mensagem:", error);
    }
  } catch (err) {
    console.error("Erro inesperado:", err);
  }
}
