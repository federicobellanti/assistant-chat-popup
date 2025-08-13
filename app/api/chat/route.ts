// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------- Simple in-memory throttle (per serverless instance) ----------
const lastCallByIp = new Map<string, number>();
const COOLDOWN_MS = 1500; // one call every 1.5s per IP

// -------- Input limits ----------
const MAX_CHARS = 4000; // adjust later if you want

// -------- Optional allow-lists (OFF unless env set) ----------
const EXPECTED_ASSISTANT = process.env.EXPECTED_ASSISTANT_ID || "";
const EXPECTED_THREAD = process.env.EXPECTED_THREAD_ID || "";

// Strip inline KB-style citations (e.g.,  or [12:...])
const stripCitations = (s: string) =>
  s
    .replace(/\u3010[\s\S]*?\u3011/g, "") // 【 ... 】
    .replace(/\[\d+:[^\]]*?\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

// Wait for a run to finish
async function waitForRun(threadId: string, runId: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await client.beta.threads.runs.retrieve(threadId, runId);
    if (run.status === "completed") return;
    if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
      throw new Error(`Run ended with status: ${run.status}`);
    }
    if (run.status === "requires_action") {
      throw new Error("Run requires_action: Assistant requested tool output (not handled here).");
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("Timeout waiting for run.");
}

// Extract only text parts from the newest assistant message
const getAssistantText = (msg: any): string => {
  if (!msg?.content) return "";
  const out: string[] = [];
  for (const c of msg.content) {
    if (c && c.type === "text" && c.text && typeof c.text.value === "string") out.push(c.text.value);
    else if (c && c.type === "output_text" && typeof c.text === "string") out.push(c.text);
  }
  return stripCitations(out.join("\n\n"));
};

export async function POST(req: NextRequest) {
  try {
    // --- Throttle ---
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const last = lastCallByIp.get(ip) || 0;
    if (now - last < COOLDOWN_MS) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 }
      );
    }
    lastCallByIp.set(ip, now);

    const { assistant_id, thread_id, message } = await req.json();

    // --- Basic validation ---
    if (!assistant_id || !thread_id || typeof message !== "string") {
      return NextResponse.json(
        { error: "assistant_id, thread_id, and message are required." },
        { status: 400 }
      );
    }
    if (message.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `Your message is too long (${message.length} chars). Max is ${MAX_CHARS}.` },
        { status: 413 }
      );
    }

    // --- Optional allow-lists (only enforced if env vars are set) ---
    if (EXPECTED_ASSISTANT && assistant_id !== EXPECTED_ASSISTANT) {
      return NextResponse.json({ error: "Assistant not allowed." }, { status: 403 });
    }
    if (EXPECTED_THREAD && thread_id !== EXPECTED_THREAD) {
      return NextResponse.json({ error: "Thread not allowed." }, { status: 403 });
    }

    // --- Add user message to the thread ---
    await client.beta.threads.messages.create(thread_id, {
      role: "user",
      content: message,
    });

    // --- Create run with extra guardrails (does NOT change your base instructions) ---
    const run = await client.beta.threads.runs.create(thread_id, {
      assistant_id,
      additional_instructions: `
You must follow these constraints in addition to your base instructions:
- Stay strictly within the HairBar model scope. If a request is unrelated, refuse briefly and redirect.
- Always answer in the user's language.
- Do not expose file names, paths, vector-store IDs, or inline citation markers. Do not include bracketed citations like 【12:...】 in the final text.
- Be concise and practical. Use short lists/steps when guiding actions.
      `.trim(),
    });

    await waitForRun(thread_id, run.id);

    // --- Newest assistant message only ---
    const list = await client.beta.threads.messages.list(thread_id, { order: "desc", limit: 10 });
    const latestAssistant = list.data.find((m) => m.role === "assistant");
    const text = getAssistantText(latestAssistant) || "";

    return NextResponse.json({ ok: true, text }, { status: 200 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}
