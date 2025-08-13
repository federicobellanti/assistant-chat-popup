// app/api/token/resolve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(s);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || "";
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const { payload } = await jwtVerify(token, getSecret());
    const assistant_id = String(payload.assistant_id || "");
    const thread_id = String(payload.thread_id || "");
    const title = String(payload.title || "AI Assistant");

    if (!assistant_id || !thread_id) {
      return NextResponse.json({ error: "Invalid token payload" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, assistant_id, thread_id, title });
  } catch (e: any) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
}
