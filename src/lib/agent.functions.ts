import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { ToolSchema } from "./groq.server";

/**
 * Agent layer — native tool calling in a loop.
 *
 * The model never sees raw scraped text and never supplies the user id: every
 * tool query is executed server-side against the caller's own RLS-scoped
 * client. Failed tool calls return a structured error string to the model
 * instead of crashing the request.
 */

const TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_saved_listings",
      description:
        "Return the roles the user has saved to their shortlist, with match score.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max rows, default 20" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_listings_closing_soon",
      description:
        "Return saved or matched roles whose application deadline falls within N days.",
      parameters: {
        type: "object",
        properties: {
          within_days: { type: "number", description: "Day window, default 7" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_matches",
      description:
        "Return the user's highest-scoring matched roles with score and justification.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max rows, default 10" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_skill_gaps",
      description:
        "Compare the user's resume skills against skills required by their matched roles and return the most common missing skills.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max skills, default 10" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_listings_semantically",
      description:
        "Semantic search across all ingested listings by meaning, not keywords.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What the user is looking for" },
        },
        required: ["query"],
      },
    },
  },
];

type SupabaseCtx = {
  supabase: {
    from: (table: string) => any;
    rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  };
  userId: string;
};

async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: SupabaseCtx,
): Promise<unknown> {
  const listingCols =
    "id, title, company, location, remote_ok, stipend, required_skills, experience_level, deadline, source";

  if (name === "get_saved_listings") {
    const limit = Number(args["limit"] ?? 20);
    const { data } = await ctx.supabase
      .from("shortlist")
      .select(`listing_id, listings(${listingCols})`)
      .eq("user_id", ctx.userId)
      .limit(Math.min(50, Math.max(1, limit)));
    return (data ?? []).map((r: any) => r.listings).filter(Boolean);
  }

  if (name === "get_listings_closing_soon") {
    const days = Number(args["within_days"] ?? 7);
    const until = new Date(Date.now() + days * 86400000)
      .toISOString()
      .slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const { data: saved } = await ctx.supabase
      .from("shortlist")
      .select("listing_id")
      .eq("user_id", ctx.userId);
    const { data: matched } = await ctx.supabase
      .from("matches")
      .select("listing_id")
      .eq("user_id", ctx.userId);
    const ids = [
      ...new Set([
        ...(saved ?? []).map((r: any) => r.listing_id),
        ...(matched ?? []).map((r: any) => r.listing_id),
      ]),
    ];
    if (ids.length === 0) return [];
    const { data } = await ctx.supabase
      .from("listings")
      .select(listingCols)
      .in("id", ids)
      .not("deadline", "is", null)
      .gte("deadline", today)
      .lte("deadline", until)
      .order("deadline", { ascending: true });
    return data ?? [];
  }

  if (name === "get_top_matches") {
    const limit = Number(args["limit"] ?? 10);
    const { data } = await ctx.supabase
      .from("matches")
      .select(`score, justification, listings(${listingCols})`)
      .eq("user_id", ctx.userId)
      .order("score", { ascending: false })
      .limit(Math.min(25, Math.max(1, limit)));
    return (data ?? []).map((r: any) => ({
      score: Number(r.score?.toFixed?.(3) ?? r.score),
      justification: r.justification,
      ...r.listings,
    }));
  }

  if (name === "get_top_skill_gaps") {
    const limit = Number(args["limit"] ?? 10);
    const { data: resume } = await ctx.supabase
      .from("resumes")
      .select("skills")
      .eq("user_id", ctx.userId)
      .eq("is_active", true)
      .maybeSingle();
    const have = new Set<string>((resume?.skills ?? []).map((s: string) => s.toLowerCase()));
    const { data: matches } = await ctx.supabase
      .from("matches")
      .select("listings(required_skills)")
      .eq("user_id", ctx.userId)
      .order("score", { ascending: false })
      .limit(40);
    const tally: Record<string, number> = {};
    for (const row of matches ?? []) {
      for (const skill of (row as any).listings?.required_skills ?? []) {
        const key = String(skill).toLowerCase();
        if (have.has(key)) continue;
        tally[key] = (tally[key] ?? 0) + 1;
      }
    }
    return Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.min(25, Math.max(1, limit)))
      .map(([skill, count]) => ({ skill, appears_in_roles: count }));
  }

  if (name === "search_listings_semantically") {
    const query = String(args["query"] ?? "").trim();
    if (!query) return { error: "query is required" };
    const { embedText } = await import("./embeddings.server");
    const vector = await embedText(query);
    const { data, error } = await ctx.supabase.rpc("match_listings", {
      query_embedding: JSON.stringify(vector),
      match_count: 10,
      min_similarity: 0,
    });
    if (error) return { error: error.message };
    return (data ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      company: r.company,
      location: r.location,
      remote_ok: r.remote_ok,
      required_skills: r.required_skills,
      experience_level: r.experience_level,
      deadline: r.deadline,
      similarity: Number(r.similarity?.toFixed?.(3) ?? r.similarity),
    }));
  }

  return { error: `Unknown tool: ${name}` };
}

export const askAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ question: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { groqChat } = await import("./groq.server");
    type ChatMessage = Parameters<typeof groqChat>[0]["messages"][number];

    await context.supabase.from("agent_messages").insert({
      user_id: context.userId,
      role: "user",
      content: data.question,
    });

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are Nexus, a career intelligence agent. Answer strictly from data returned by your tools — never invent listings, scores or deadlines. Today is ${new Date().toISOString().slice(0, 10)}. If a tool returns an empty list, say so plainly and suggest the next step (ingest listings, upload a resume, or run matching). Be concise and specific.`,
      },
      { role: "user", content: data.question },
    ];

    const trace: { tool: string; args: unknown; resultPreview: string }[] = [];
    let answer = "";

    for (let step = 0; step < 5; step++) {
      const result = await groqChat({
        messages,
        task: "run_agent_turn",
        userId: context.userId,
        tools: TOOLS,
        temperature: 0.2,
        maxTokens: 1200,
      });

      if (result.toolCalls.length === 0) {
        answer = result.content.trim();
        break;
      }

      messages.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        let payload: unknown;
        try {
          const args = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
          payload = await runTool(
            call.function.name,
            args,
            context as unknown as SupabaseCtx,
          );
          trace.push({
            tool: call.function.name,
            args,
            resultPreview: JSON.stringify(payload).slice(0, 400),
          });
        } catch (err) {
          payload = {
            error: err instanceof Error ? err.message : "tool execution failed",
          };
          trace.push({
            tool: call.function.name,
            args: call.function.arguments,
            resultPreview: JSON.stringify(payload),
          });
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(payload).slice(0, 8000),
        });
      }
    }

    if (!answer) {
      answer =
        "I couldn't finish that request — the tool loop ran out of steps. Try asking something more specific.";
    }

    const { data: saved } = await context.supabase
      .from("agent_messages")
      .insert({
        user_id: context.userId,
        role: "assistant",
        content: answer,
        tool_trace: trace,
      })
      .select("id, role, content, tool_trace, created_at")
      .maybeSingle();

    return { answer, trace, message: saved };
  });

export const getAgentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("agent_messages")
      .select("id, role, content, tool_trace, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(100);
    return data ?? [];
  });

export const clearAgentHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("agent_messages")
      .delete()
      .eq("user_id", context.userId);
    return { ok: true };
  });
