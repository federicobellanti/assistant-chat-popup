// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Vercel-friendly settings
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // organization: process.env.OPENAI_ORGANIZATION,
  // project: process.env.OPENAI_PROJECT,
});

// --- helpers (module scope) ---

async function waitForRun(threadId: string, runId: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await client.beta.threads.runs.retrieve(threadId, runId);

    if (run.status === "completed") return;

    // Treat failure-like terminal states as errors
    if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
      throw new Error(`Run ended with status: ${run.status}`);
    }

    // If the run requires action (tool calls), surface it clearly
    if (run.status === "requires_action") {
      throw new Error("Run requires_action: the Assistant is requesting tool output. Disable tools or handle tool calls.");
    }

    // Still queued/in_progress/cancelling → wait
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("Timeout waiting for run.");
}

const getAssistantText = (msg: any): string => {
  if (!msg?.content) return "";
  const parts: string[] = [];
  for (const c of msg.content) {
    // Common v2 text block
    if (c && c.type === "text" && c.text && typeof c.text.value === "string") {
      parts.push(c.text.value);
    }
    // Some tool outputs use a different shape
    else if (c && c.type === "output_text" && typeof c.text === "string") {
      parts.push(c.text);
    }
  }
  return parts.join("\n\n").trim();
};

// --- route handler ---

export async function POST(req: NextRequest) {
  try {
    const { assistant_id, thread_id, message } = await req.json();

    if (!assistant_id || !thread_id || typeof message !== "string") {
      return NextResponse.json(
        { error: "assistant_id, thread_id, and message are required." },
        { status: 400 }
      );
    }

    // 1) Add user message to the thread
    await client.beta.threads.messages.create(thread_id, {
      role: "user",
      content: message,
    });

    // 2) Create a run
    const run = await client.beta.threads.runs.create(thread_id, { assistant_id });

    // 3) Wait for completion
    await waitForRun(thread_id, run.id);

    // 4) Fetch only the latest assistant message
    const list = await client.beta.threads.messages.list(thread_id, {
      order: "desc",
      limit: 10,
    });
    const latestAssistant = list.data.find((m) => m.role === "assistant");
    const text = getAssistantText(latestAssistant) || "";

    return NextResponse.json({ ok: true, text }, { status: 200 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
