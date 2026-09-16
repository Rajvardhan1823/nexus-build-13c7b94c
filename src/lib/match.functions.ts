import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Semantic matching layer. Resume and listing vectors share one embedding
 * space; ranking is cosine similarity over structured listing fields.
 * Justification is a separate cheap LLM call so a failure there never
 * corrupts core matching data.
 */

const RunMatchInput = z.object({
  limit: z.number().int().min(5).max(50),
  justifyTop: z.number().int().min(0).max(10),
});

export const runMatching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunMatchInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: resume } = await context.supabase
      .from("resumes")
      .select("id, raw_text, skills")
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!resume) {
      throw new Error("Upload a resume before running matching.");
    }

    const { embedText } = await import("./embeddings.server");
    const queryVector = await embedText(
      `${(resume.skills ?? []).join(", ")}\n\n${resume.raw_text.slice(0, 15000)}`,
    );

    const { data: rows, error } = await context.supabase.rpc("match_listings", {
      query_embedding: JSON.stringify(queryVector) as unknown as string,
      match_count: data.limit,
      min_similarity: 0,
    });
    if (error) throw new Error(error.message);

    const matches = (rows ?? []) as {
      id: string;
      title: string | null;
      similarity: number;
      required_skills: string[] | null;
      experience_level: string | null;
      company: string | null;
      description: string | null;
    }[];

    if (matches.length === 0) {
      return { matched: 0, justified: 0 };
    }

    await context.supabase
      .from("matches")
      .upsert(
        matches.map((m) => ({
          user_id: context.userId,
          resume_id: resume.id,
          listing_id: m.id,
          score: m.similarity,
        })),
        { onConflict: "resume_id,listing_id" },
      );

    // Justify only the top N, and never let it break the match write above.
    let justified = 0;
    if (data.justifyTop > 0) {
      const { groqChat } = await import("./groq.server");
      for (const m of matches.slice(0, data.justifyTop)) {
        try {
          const result = await groqChat({
            task: "generate_justification",
            userId: context.userId,
            temperature: 0.3,
            maxTokens: 220,
            messages: [
              {
                role: "system",
                content:
                  "You explain why a candidate fits a role. Two sentences maximum, concrete, referencing overlapping skills and any gap. No preamble.",
              },
              {
                role: "user",
                content: `CANDIDATE SKILLS: ${(resume.skills ?? []).join(", ")}\n\nRESUME EXCERPT:\n${resume.raw_text.slice(0, 2500)}\n\nROLE: ${m.title ?? "Untitled"} at ${m.company ?? "unknown"}\nROLE SKILLS: ${(m.required_skills ?? []).join(", ")}\nLEVEL: ${m.experience_level ?? "unknown"}\nSUMMARY: ${m.description ?? ""}`,
              },
            ],
          });
          if (result.content.trim()) {
            await context.supabase
              .from("matches")
              .update({ justification: result.content.trim() })
              .eq("user_id", context.userId)
              .eq("resume_id", resume.id)
              .eq("listing_id", m.id);
            justified++;
          }
        } catch {
          // Justification is best-effort.
        }
      }
    }

    return { matched: matches.length, justified };
  });

export const getMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("matches")
      .select(
        "id, score, justification, listing_id, listings(id, title, company, location, remote_ok, stipend, required_skills, experience_level, deadline, apply_url, source, source_url, description)",
      )
      .eq("user_id", context.userId)
      .order("score", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);

    const { data: saved } = await context.supabase
      .from("shortlist")
      .select("listing_id")
      .eq("user_id", context.userId);
    const savedIds = new Set((saved ?? []).map((s) => s.listing_id));

    return (data ?? [])
      .filter((row) => row.listings)
      .map((row) => ({
        matchId: row.id,
        score: row.score,
        justification: row.justification,
        saved: savedIds.has(row.listing_id),
        listing: row.listings!,
      }));
  });

/** Semantic search over listings — proves matching is semantic, not keyword. */
export const semanticSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().min(2).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { embedText } = await import("./embeddings.server");
    const vector = await embedText(data.query);
    const { data: rows, error } = await context.supabase.rpc("match_listings", {
      query_embedding: JSON.stringify(vector) as unknown as string,
      match_count: 15,
      min_similarity: 0,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
