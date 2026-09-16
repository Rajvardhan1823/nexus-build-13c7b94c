import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SaveResumeInput = z.object({
  filename: z.string().trim().max(200).nullable(),
  text: z.string().trim().min(1).max(60000),
});

/** Near-empty extraction (scanned PDFs) is rejected, never embedded as garbage. */
const MIN_RESUME_CHARS = 300;

export const saveResume = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveResumeInput.parse(input))
  .handler(async ({ data, context }) => {
    const clean = data.text.replace(/\u0000/g, "").replace(/\s+\n/g, "\n").trim();
    if (clean.length < MIN_RESUME_CHARS) {
      throw new Error(
        `Only ${clean.length} characters of text were readable. This looks like a scanned or image-only file — please upload a text-based PDF or paste your resume text.`,
      );
    }

    const { groqJson } = await import("./groq.server");
    const { embedText } = await import("./embeddings.server");

    let skills: string[] = [];
    try {
      const { value } = await groqJson({
        system:
          'Extract the candidate skills from a resume. Return ONLY {"skills": string[]} with at most 25 concrete lowercase skills/technologies. No prose.',
        user: clean.slice(0, 12000),
        task: "extract_resume_skills",
        userId: context.userId,
        validate: (v) => z.object({ skills: z.array(z.string()).max(40) }).parse(v),
      });
      skills = value.skills.map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 25);
    } catch {
      skills = [];
    }

    const vector = await embedText(
      `${skills.join(", ")}\n\n${clean.slice(0, 15000)}`,
    );

    await context.supabase
      .from("resumes")
      .update({ is_active: false })
      .eq("user_id", context.userId);

    const { data: inserted, error } = await context.supabase
      .from("resumes")
      .insert({
        user_id: context.userId,
        filename: data.filename,
        raw_text: clean,
        char_count: clean.length,
        skills,
        embedding: JSON.stringify(vector),
        is_active: true,
      })
      .select("id, filename, char_count, skills, created_at")
      .maybeSingle();

    if (error) throw new Error(error.message);
    return inserted;
  });

export const getActiveResume = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("resumes")
      .select("id, filename, char_count, skills, created_at, raw_text")
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const { raw_text, ...rest } = data;
    return { ...rest, preview: raw_text.slice(0, 600) };
  });
