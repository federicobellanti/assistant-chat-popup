import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { assistant_id, thread_id, message } = body;

    if (!assistant_id || !thread_id) {
      return NextResponse.json(
        { error: "Missing assistant_id or thread_id" },
        { status: 400 }
      );
    }

    // Create the user message
    await client.beta.threads.messages.create(thread_id, {
      role: "user",
      content: message,
    });

    // Run the assistant
    await client.beta.threads.runs.create(thread_id, {
      assistant_id,
    });

    // Wait briefly to let the run complete
    await new Promise((r) => setTimeout(r, 2000));

    // Get the latest assistant message
    const list = await client.beta.threads.messages.list(thread_id, {
      order: "desc",
      limit: 10,
    });
    const latestAssistant = list.data.find((m) => m.role === "assistant");

    function getAssistantText(msg: any): string {
      if (!msg?.content) return "";
      const parts: string[] = [];
      for (const c of msg.content) {
        if (c && c.type === "text" && c.text && typeof c.text.value === "string") {
          parts.push(c.text.value);
        } else if (
          c &&
          c.type === "output_text" &&
          typeof c.text === "string"
        ) {
          parts.push(c.text);
        }
      }
      return parts.join("\n\n").trim();
    }

    const text = getAssistantText(latestAssistant);

    return NextResponse.json({ ok: true, text });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
