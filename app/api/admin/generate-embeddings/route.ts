import { NextResponse } from "next/server";
import { supabase } from "../../../internal/supabaseClient";

export async function GET() {
  try {
    // 1) Buscar registros sem embedding
    const { data: rows, error: selectError } = await supabase
      .from("knowledge_base")
      .select("*")
      .is("embedding", null);

    if (selectError) {
      console.error("Erro ao buscar registros:", selectError);
      return NextResponse.json(
        { error: "Erro ao buscar registros." },
        { status: 500 }
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        message: "Nenhum registro pendente para gerar embeddings."
      });
    }

    console.log(`Gerando embeddings para ${rows.length} registros...`);

    // 2) Gerar embeddings
    const embeddings = await Promise.all(
      rows.map(async (row) => {
        const response = await fetch(
          "https://api.openai.com/v1/embeddings",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "text-embedding-3-large",
              input: row.content,
            }),
          }
        );

        const json = await response.json();
        const vector = json.data?.[0]?.embedding;

        if (!vector) {
          console.error("Erro ao gerar embedding para ID", row.id, json);
          return null;
        }

        return { id: row.id, embedding: vector };
      })
    );

    // 3) Atualizar cada embedding no Supabase
    for (const item of embeddings) {
      if (!item) continue;

      const { error: updateError } = await supabase
        .from("knowledge_base")
        .update({ embedding: item.embedding })
        .eq("id", item.id);

      if (updateError) {
        console.error("Erro na atualização do registro:", updateError);
      }
    }

    return NextResponse.json({
      message: "Embeddings gerados e atualizados com sucesso!",
      total: rows.length,
    });
  } catch (err) {
    console.error("Erro geral no endpoint:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
