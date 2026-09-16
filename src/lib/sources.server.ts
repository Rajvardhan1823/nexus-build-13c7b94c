/**
 * Scraper layer — two structurally different sources.
 *
 * 1. SerpAPI (Google Jobs): partially structured API feed.
 * 2. We Work Remotely: direct HTML scraping of a paginated listing index plus
 *    per-listing detail pages, with politeness (delay + jitter, real
 *    User-Agent, robots.txt respected).
 *
 * Both produce the same RawListing shape. Raw text is stored separately from
 * the structured table so extraction bugs can be fixed and re-run without
 * re-scraping.
 */

export type RawListing = {
  source: string;
  sourceListingId: string | null;
  sourceUrl: string;
  rawText: string;
};

const USER_AGENT =
  "NexusCareerBot/1.0 (+https://lovable.dev; career-intelligence research project)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const politeDelay = () => sleep(700 + Math.random() * 800);

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------------------------------------------ */
/* robots.txt                                                          */
/* ------------------------------------------------------------------ */

const robotsCache = new Map<string, string[]>();

async function disallowedPaths(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  let rules: string[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.ok) {
      const text = await res.text();
      let applies = false;
      for (const line of text.split("\n")) {
        const clean = line.split("#")[0]!.trim();
        if (!clean) continue;
        const [rawKey, ...rest] = clean.split(":");
        const keyName = rawKey!.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (keyName === "user-agent") applies = value === "*";
        else if (applies && keyName === "disallow" && value) rules.push(value);
      }
    }
  } catch {
    rules = [];
  }
  robotsCache.set(origin, rules);
  return rules;
}

export async function isAllowed(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const rules = await disallowedPaths(parsed.origin);
    return !rules.some((rule) => rule !== "/" && parsed.pathname.startsWith(rule));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Source 1 — SerpAPI Google Jobs                                      */
/* ------------------------------------------------------------------ */

type SerpJob = {
  job_id?: string;
  title?: string;
  company_name?: string;
  location?: string;
  description?: string;
  via?: string;
  share_link?: string;
  detected_extensions?: Record<string, unknown>;
  job_highlights?: { title?: string; items?: string[] }[];
  apply_options?: { title?: string; link?: string }[];
};

export async function fetchSerpApiJobs(
  query: string,
  location: string | null,
  pages: number,
): Promise<RawListing[]> {
  const key = process.env["SERPAPI_API_KEY"];
  if (!key) throw new Error("SERPAPI_API_KEY is not configured.");

  const results: RawListing[] = [];

  for (let page = 0; page < Math.max(1, pages); page++) {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_jobs");
    url.searchParams.set("q", query);
    if (location) url.searchParams.set("location", location);
    url.searchParams.set("hl", "en");
    url.searchParams.set("api_key", key);
    if (page > 0) url.searchParams.set("start", String(page * 10));

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SerpAPI failed [${res.status}]: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      jobs_results?: SerpJob[];
      error?: string;
    };
    if (data.error) throw new Error(`SerpAPI: ${data.error}`);

    const jobs = data.jobs_results ?? [];
    if (jobs.length === 0) break; // pagination stop: empty result set

    for (const job of jobs) {
      const highlights = (job.job_highlights ?? [])
        .map(
          (h) =>
            `${h.title ?? "Details"}:\n${(h.items ?? []).map((i) => `- ${i}`).join("\n")}`,
        )
        .join("\n\n");
      const applyLink =
        job.apply_options?.find((o) => o.link)?.link ?? job.share_link ?? "";
      const extensions = job.detected_extensions
        ? JSON.stringify(job.detected_extensions)
        : "";

      const rawText = [
        `Title: ${job.title ?? ""}`,
        `Company: ${job.company_name ?? ""}`,
        `Location: ${job.location ?? ""}`,
        `Posted via: ${job.via ?? ""}`,
        extensions ? `Extensions: ${extensions}` : "",
        applyLink ? `Apply: ${applyLink}` : "",
        "",
        job.description ?? "",
        "",
        highlights,
      ]
        .filter(Boolean)
        .join("\n")
        .trim();

      if (!rawText) continue;
      results.push({
        source: "google_jobs_serpapi",
        sourceListingId: job.job_id ?? null,
        sourceUrl: applyLink || job.share_link || "https://www.google.com/search?q=jobs",
        rawText,
      });
    }
    await politeDelay();
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Source 2 — We Work Remotely, scraped directly                       */
/* ------------------------------------------------------------------ */

const WWR_ORIGIN = "https://weworkremotely.com";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function scrapeWeWorkRemotely(
  categoryPath: string,
  maxPages: number,
  maxListings: number,
): Promise<RawListing[]> {
  const out: RawListing[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= Math.max(1, maxPages); page++) {
    const indexUrl = `${WWR_ORIGIN}${categoryPath}${page > 1 ? `?page=${page}` : ""}`;
    if (!(await isAllowed(indexUrl))) break;

    const res = await fetch(indexUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) break;
    const html = await res.text();

    const slugs = [
      ...new Set(
        [...html.matchAll(/href="(\/remote-jobs\/[^"?#]+)"/g)].map((m) => m[1]!),
      ),
    ];
    if (slugs.length === 0) break; // pagination stop: no new content

    let added = 0;
    for (const slug of slugs) {
      if (out.length >= maxListings) break;
      if (seen.has(slug)) continue;
      seen.add(slug);
      added++;

      const detailUrl = `${WWR_ORIGIN}${slug}`;
      if (!(await isAllowed(detailUrl))) continue;
      try {
        await politeDelay();
        const detail = await fetch(detailUrl, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        });
        if (!detail.ok) continue;
        const detailHtml = await detail.text();
        const title =
          detailHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
        const body = stripHtml(
          detailHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? detailHtml,
        ).slice(0, 12000);
        if (body.length < 200) continue;

        out.push({
          source: "weworkremotely_scraped",
          sourceListingId: slug.split("/").filter(Boolean).pop() ?? null,
          sourceUrl: detailUrl,
          rawText: `Page title: ${title}\n\n${body}`,
        });
      } catch {
        // One bad detail page never halts the crawl.
        continue;
      }
    }

    if (added === 0 || out.length >= maxListings) break;
  }

  return out;
}
