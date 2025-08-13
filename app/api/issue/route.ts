// app/api/issue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(s);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const assistant_id = url.searchParams.get("assistant_id") || "";
  const thread_id = url.searchParams.get("thread_id") || "";
  const title = url.searchParams.get("title") || "AI Assistant";

  if (!assistant_id || !thread_id) {
    return NextResponse.json(
      { error: "assistant_id and thread_id are required" },
      { status: 400 }
    );
  }

  const token = await new SignJWT({ assistant_id, thread_id, title })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSecret());

  // Redirect to /launch?token=... so raw IDs don’t linger in the bar.
  const redirectTo = new URL(req.url);
  redirectTo.pathname = "/launch";
  redirectTo.search = `?token=${encodeURIComponent(token)}`;
  return NextResponse.redirect(redirectTo.toString(), 302);
}
