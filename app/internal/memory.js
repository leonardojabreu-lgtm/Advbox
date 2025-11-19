const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn(
    "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados. A memória por cliente não irá funcionar corretamente."
  );
}

// Busca últimas mensagens de um cliente
export async function getHistory(userNumber, limit = 20) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  try {
    const url = `${SUPABASE_URL}/rest/v1/messages_memory?user_number=eq.${encodeURIComponent(
      userNumber
    )}&order=created_at.asc&limit=${limit}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      console.error("Erro ao buscar histórico no Supabase:", await resp.text());
      return [];
    }

    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    return data;
  } catch (err) {
    console.error("Erro getHistory:", err);
    return [];
  }
}

// Salva mensagem na memória
export async function saveMessage(userNumber, role, content) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  try {
    const url = `${SUPABASE_URL}/rest/v1/messages_memory`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_number: userNumber,
        role,
        content,
      }),
    });

    if (!resp.ok) {
      console.error("Erro ao salvar mensagem no Supabase:", await resp.text());
    }
  } catch (err) {
    console.error("Erro saveMessage:", err);
  }
}
