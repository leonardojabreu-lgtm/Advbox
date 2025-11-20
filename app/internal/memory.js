import { supabase } from "./supabaseClient";

// Tabela: whatsapp_history
// colunas: id (uuid), user_id (text), role (text), content (text), created_at (timestamp), conversation_id (uuid)

// Busca (ou cria) uma conversa em andamento para esse número
async function getOrCreateConversation(userId) {
  if (!supabase) return null;

  // 1) Tenta achar conversa em andamento
  const { data: existing, error: convError } = await supabase
    .from("conversations")
    .select("*")
    .eq("phone", userId)
    .eq("status", "em_andamento")
    .order("started_at", { ascending: true })
    .limit(1);

  if (convError) {
    console.error("Erro ao buscar conversa no Supabase:", convError);
    return null;
  }

  if (existing && existing.length > 0) {
    return existing[0];
  }

  // 2) Se não existir, cria uma nova
  const { data: inserted, error: insertError } = await supabase
    .from("conversations")
    .insert({
      phone: userId,
      status: "em_andamento",
    })
    .select("*")
    .limit(1);

  if (insertError) {
    console.error("Erro ao criar conversa no Supabase:", insertError);
    return null;
  }

  return inserted ? inserted[0] : null;
}

// Encerrar conversa (opcional, você chama de fora quando quiser)
export async function closeConversation(userId) {
  if (!supabase) return;

  try {
    const { data: existing, error: convError } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", userId)
      .eq("status", "em_andamento")
      .order("started_at", { ascending: true })
      .limit(1);

    if (convError) {
      console.error("Erro ao buscar conversa para encerrar:", convError);
      return;
    }

    if (!existing || existing.length === 0) return;

    const conv = existing[0];

    const { error: updateError } = await supabase
      .from("conversations")
      .update({
        status: "encerrada",
        ended_at: new Date().toISOString(),
      })
      .eq("id", conv.id);

    if (updateError) {
      console.error("Erro ao encerrar conversa:", updateError);
    }
  } catch (err) {
    console.error("Erro inesperado ao encerrar conversa:", err);
  }
}

// Retorna todo o histórico desse usuário (todas as mensagens)
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

// Salva uma nova mensagem no histórico, já vinculando à conversa
export async function saveMessage(userId, role, content) {
  if (!supabase) return;

  try {
    const conversation = await getOrCreateConversation(userId);

    const payload = {
      user_id: userId,
      role,
      content,
    };

    if (conversation) {
      payload.conversation_id = conversation.id;
    }

    const { error } = await supabase.from("whatsapp_history").insert(payload);

    if (error) {
      console.error("Erro ao salvar mensagem no Supabase:", error);
    }
  } catch (err) {
    console.error("Erro inesperado ao salvar mensagem:", err);
  }
}
