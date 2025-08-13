// app/api/new-thread/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Optional: set ADMIN_NEWTHREAD_TOKEN in Vercel if you want a basic shared-secret gate.
const ADMIN_TOKEN = process.env.ADMIN_NEWTHREAD_TOKEN || "";

export async function POST(req: NextRequest) {
  try {
    if (ADMIN_TOKEN) {
      const auth = req.headers.get("authorization") || "";
      if (auth !== `Bearer ${ADMIN_TOKEN}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({} as any));
    const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : undefined;

    const thread = await client.beta.threads.create({ metadata });
    return NextResponse.json({ ok: true, thread_id: thread.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
