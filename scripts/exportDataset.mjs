import fs from "fs";
import { createClient } from "@supabase/supabase-js";

// 🔑 Pegando suas credenciais
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

console.log("🔄 Exportando dataset do WhatsApp…");

async function exportDataset() {
  try {
    // 1) Busca TUDO do histórico
    const { data: messages, error } = await supabase
      .from("whatsapp_history")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Agrupa por cliente (user_id)
    const grouped = {};
    for (const msg of messages) {
      if (!grouped[msg.user_id]) grouped[msg.user_id] = [];
      grouped[msg.user_id].push(msg);
    }

    const lines = [];

    // Para cada cliente, criar um bloco de diálogo
    for (const userId of Object.keys(grouped)) {
      const chat = grouped[userId];

      const formatted = chat.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

      // Adiciona uma linha no dataset
      lines.push(JSON.stringify({ messages: formatted }));
    }

    // Salva arquivo final
    fs.writeFileSync("dataset.jsonl", lines.join("\n"), "utf8");

    console.log("✅ Dataset criado com sucesso!");
    console.log("📄 Arquivo: dataset.jsonl");
  } catch (err) {
    console.error("❌ Erro ao gerar dataset:", err);
  }
}

exportDataset();
