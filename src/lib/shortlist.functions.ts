import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const toggleShortlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ listingId: z.string().uuid(), saved: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.saved) {
      const { error } = await context.supabase
        .from("shortlist")
        .upsert(
          { user_id: context.userId, listing_id: data.listingId },
          { onConflict: "user_id,listing_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("shortlist")
        .delete()
        .eq("user_id", context.userId)
        .eq("listing_id", data.listingId);
      if (error) throw new Error(error.message);
    }
    return { saved: data.saved };
  });

export const getShortlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("shortlist")
      .select(
        "id, created_at, listing_id, listings(id, title, company, location, remote_ok, stipend, required_skills, experience_level, deadline, apply_url, source, source_url, description)",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const listingIds = (data ?? []).map((r) => r.listing_id);

    const [{ data: matches }, { data: jobs }] = await Promise.all([
      context.supabase
        .from("matches")
        .select("listing_id, score, justification")
        .eq("user_id", context.userId)
        .in("listing_id", listingIds.length ? listingIds : [crypto.randomUUID()]),
      context.supabase
        .from("jobs")
        .select("id, kind, status, payload, result, error, created_at, finished_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const scoreByListing = new Map(
      (matches ?? []).map((m) => [m.listing_id, m]),
    );

    return (data ?? [])
      .filter((row) => row.listings)
      .map((row) => {
        const match = scoreByListing.get(row.listing_id);
        return {
          id: row.id,
          savedAt: row.created_at,
          listing: row.listings!,
          score: match?.score ?? null,
          justification: match?.justification ?? null,
          launchKits: (jobs ?? []).filter(
            (j) =>
              j.kind === "launchkit" &&
              (j.payload as { listingId?: string } | null)?.listingId ===
                row.listing_id,
          ),
        };
      });
  });
