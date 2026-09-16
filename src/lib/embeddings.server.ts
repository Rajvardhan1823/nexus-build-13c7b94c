/**
 * Embeddings service. One model for both resumes and listings — cosine
 * similarity is only meaningful inside a single embedding space.
 */

const EMBED_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
export const EMBED_MODEL = "google/gemini-embedding-2";
export const EMBED_DIMS = 3072;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Roughly 8k tokens; keep each input comfortably inside the model cap. */
const MAX_CHARS = 20000;

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY is not configured.");

  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += 50) {
    const batch = inputs
      .slice(i, i + 50)
      .map((t) => (t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t) || " ");

    let vectors: number[][] | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(EMBED_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          data: { index: number; embedding: number[] }[];
        };
        vectors = data.data
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);
        break;
      }

      const body = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 300);
        continue;
      }
      throw new Error(`Embedding failed [${res.status}]: ${body.slice(0, 300)}`);
    }

    if (!vectors) throw new Error("Embedding failed after retries.");
    out.push(...vectors);
  }
  return out;
}

export async function embedText(input: string): Promise<number[]> {
  const [vector] = await embedTexts([input]);
  if (!vector) throw new Error("Embedding returned no vector.");
  return vector;
}
