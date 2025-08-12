import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION, // optional
  project: process.env.OPENAI_PROJECT,           // optional
});

async function waitForRun(threadId: string, runId: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await client.beta.threads.runs.retrieve(threadId, runId);
    if (run.status === "completed") return;
    if (["failed","cancelled","expired","incomplete"].includes(run.status as string)) {
      throw new Error(`Run ended with status: ${run.status}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  throw new Error("Timeout waiting for run.");
}

export async function POST(req: NextRequest) {
  try {
    const { assistant_id, thread_id, message } = await req.json();
    if (!assistant_id || !thread_id || !message) {
      return NextResponse.json({ error: "assistant_id, thread_id, message are required." }, { status: 400 });
    }

    await client.beta.threads.messages.create(thread_id, { role: "user", content: message });
    const run = await client.beta.threads.runs.create(thread_id, { assistant_id });
    await waitForRun(thread_id, run.id);

    const list = await client.beta.threads.messages.list(thread_id, { order: "desc", limit: 10 });
    const text = list.data
      .filter(m => m.role === "assistant")
      .flatMap(m => m.content)
      .filter(c => c.type === "text")
      .map(c => (c.type === "text" ? c.text.value : ""))
      .join("\n\n")
      .trim();

    return NextResponse.json({ ok: true, text }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
