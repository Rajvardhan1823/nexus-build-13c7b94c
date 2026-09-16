import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Ingestion + extraction pipeline.
 *
 * scrape -> store raw -> LLM extraction into a fixed schema -> embed.
 * Every stage degrades gracefully: one bad listing is marked failed and the
 * batch continues.
 */

const IngestInput = z.object({
  query: z.string().trim().min(2).max(120),
  location: z.string().trim().max(120).nullable(),
  serpPages: z.number().int().min(0).max(3),
  wwrPages: z.number().int().min(0).max(3),
  maxListings: z.number().int().min(1).max(60),
});

const ExtractionSchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  remote_ok: z.boolean().nullable(),
  stipend: z.string().nullable(),
  required_skills: z.array(z.string()).max(30),
  experience_level: z
    .enum(["internship", "entry", "mid", "senior", "unknown"])
    .nullable(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  summary: z.string().nullable(),
  apply_url: z.string().nullable(),
});

const EXTRACTION_SYSTEM = `You normalize messy job listing text into a fixed JSON schema.
Return ONLY a JSON object with exactly these keys:
{
  "title": string|null,
  "company": string|null,
  "location": string|null,
  "remote_ok": boolean|null,
  "stipend": string|null,          // pay/salary/stipend as written, else null
  "required_skills": string[],     // concrete skills/technologies, max 15, lowercase
  "experience_level": "internship"|"entry"|"mid"|"senior"|"unknown"|null,
  "deadline": string|null,         // strict YYYY-MM-DD, null if not explicitly stated
  "summary": string|null,          // max 60 words, plain text
  "apply_url": string|null
}
Never invent facts. Never output prose or markdown fences.`;

export const runIngestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IngestInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchSerpApiJobs, scrapeWeWorkRemotely, sha256 } = await import(
      "./sources.server"
    );
    const { groqJson } = await import("./groq.server");
    const { embedTexts } = await import("./embeddings.server");

    const report = {
      scraped: 0,
      newRaw: 0,
      duplicates: 0,
      extracted: 0,
      failed: 0,
      embedded: 0,
      sourceErrors: [] as string[],
    };

    // --- 1. Scrape ------------------------------------------------------
    const scraped: Awaited<ReturnType<typeof fetchSerpApiJobs>> = [];

    if (data.serpPages > 0) {
      try {
        scraped.push(
          ...(await fetchSerpApiJobs(data.query, data.location, data.serpPages)),
        );
      } catch (err) {
        report.sourceErrors.push(
          `Google Jobs: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (data.wwrPages > 0) {
      try {
        scraped.push(
          ...(await scrapeWeWorkRemotely(
            "/categories/remote-programming-jobs",
            data.wwrPages,
            Math.max(5, Math.floor(data.maxListings / 2)),
          )),
        );
      } catch (err) {
        report.sourceErrors.push(
          `We Work Remotely: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    report.scraped = scraped.length;
    const budget = scraped.slice(0, data.maxListings);

    // --- 2. Store raw (dedup by content hash) ---------------------------
    type Pending = { rawId: string; rawText: string; source: string; url: string };
    const pending: Pending[] = [];

    for (const item of budget) {
      const hash = await sha256(
        `${item.source}|${item.sourceListingId ?? item.sourceUrl}|${item.rawText}`,
      );
      const { data: existing } = await supabaseAdmin
        .from("raw_listings")
        .select("id")
        .eq("content_hash", hash)
        .maybeSingle();

      if (existing) {
        report.duplicates++;
        await supabaseAdmin
          .from("raw_listings")
          .update({ last_seen_at: new Date().toISOString(), is_active: true })
          .eq("id", existing.id);
        continue;
      }

      const { data: inserted, error } = await supabaseAdmin
        .from("raw_listings")
        .insert({
          source: item.source,
          source_listing_id: item.sourceListingId,
          source_url: item.sourceUrl,
          raw_text: item.rawText,
          content_hash: hash,
        })
        .select("id")
        .maybeSingle();

      if (error || !inserted) continue;
      report.newRaw++;
      pending.push({
        rawId: inserted.id,
        rawText: item.rawText,
        source: item.source,
        url: item.sourceUrl,
      });
    }

    // --- 3. Extract (per listing; failure isolated) ---------------------
    const embedQueue: { listingId: string; text: string }[] = [];

    for (const item of pending) {
      try {
        const { value } = await groqJson({
          system: EXTRACTION_SYSTEM,
          user: `Source: ${item.source}\nURL: ${item.url}\n\nRAW LISTING:\n${item.rawText.slice(0, 9000)}`,
          task: "extract_listing",
          userId: context.userId,
          validate: (v) => ExtractionSchema.parse(v),
        });

        const skills = value.required_skills
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 15);

        const { data: listing } = await supabaseAdmin
          .from("listings")
          .insert({
            raw_listing_id: item.rawId,
            source: item.source,
            source_url: item.url,
            title: value.title,
            company: value.company,
            location: value.location,
            remote_ok: value.remote_ok,
            stipend: value.stipend,
            required_skills: skills,
            experience_level: value.experience_level,
            deadline: value.deadline,
            description: value.summary,
            apply_url: value.apply_url ?? item.url,
            extraction_status: "done",
          })
          .select("id")
          .maybeSingle();

        if (listing) {
          report.extracted++;
          embedQueue.push({
            listingId: listing.id,
            // Embed structured fields, not the boilerplate-heavy raw text.
            text: [
              value.title ?? "",
              skills.join(", "),
              value.experience_level ?? "",
              value.remote_ok ? "remote" : (value.location ?? ""),
              value.summary ?? "",
            ]
              .filter(Boolean)
              .join(" | "),
          });
        }
      } catch (err) {
        report.failed++;
        await supabaseAdmin.from("listings").insert({
          raw_listing_id: item.rawId,
          source: item.source,
          source_url: item.url,
          extraction_status: "failed",
          extraction_error:
            err instanceof Error ? err.message.slice(0, 900) : String(err),
        });
      }
    }

    // --- 4. Embed -------------------------------------------------------
    if (embedQueue.length > 0) {
      try {
        const vectors = await embedTexts(embedQueue.map((e) => e.text));
        for (let i = 0; i < embedQueue.length; i++) {
          const vector = vectors[i];
          if (!vector) continue;
          await supabaseAdmin
            .from("listings")
            .update({ embedding: JSON.stringify(vector) })
            .eq("id", embedQueue[i]!.listingId);
          report.embedded++;
        }
      } catch (err) {
        report.sourceErrors.push(
          `Embedding: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return report;
  });

export const getPipelineStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const counts = async (
      table: "raw_listings" | "listings",
      apply?: (q: ReturnType<typeof buildQuery>) => unknown,
    ) => {
      let q = supabaseAdmin.from(table).select("*", { count: "exact", head: true });
      if (apply) q = apply(q) as typeof q;
      const { count } = await q;
      return count ?? 0;
    };
    const buildQuery = () =>
      supabaseAdmin.from("listings").select("*", { count: "exact", head: true });

    const [raw, structured, failed, embedded, sources, recentCalls] =
      await Promise.all([
        counts("raw_listings"),
        counts("listings", (q) =>
          (q as ReturnType<typeof buildQuery>).eq("extraction_status", "done"),
        ),
        counts("listings", (q) =>
          (q as ReturnType<typeof buildQuery>).eq("extraction_status", "failed"),
        ),
        counts("listings", (q) =>
          (q as ReturnType<typeof buildQuery>).not("embedding", "is", null),
        ),
        supabaseAdmin.from("raw_listings").select("source"),
        supabaseAdmin
          .from("llm_calls")
          .select("task, ok, created_at")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

    const bySource: Record<string, number> = {};
    for (const row of sources.data ?? []) {
      bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    }
    const byTask: Record<string, { ok: number; failed: number }> = {};
    for (const row of recentCalls.data ?? []) {
      const entry = (byTask[row.task] ??= { ok: 0, failed: 0 });
      if (row.ok) entry.ok++;
      else entry.failed++;
    }

    return { raw, structured, failed, embedded, bySource, byTask };
  });

export const getFailedExtractions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("listings")
      .select("id, source, source_url, extraction_error, created_at")
      .eq("extraction_status", "failed")
      .order("created_at", { ascending: false })
      .limit(25);
    return data ?? [];
  });
