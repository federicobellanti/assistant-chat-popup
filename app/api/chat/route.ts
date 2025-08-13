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

// -------- Studio Bellanti contact line (used on refusal/fallback) -----
const contactLine =
  "Non dispongo di informazioni sufficienti nella documentazione del modello HairBar per rispondere con certezza. " +
  "Ti invito a contattare direttamente lo Studio Bellanti: info@studiobellanti.com oppure al numero consueto.";

// -------- Strip inline KB-style citations (e.g.,  or [12:...]) ----
const stripCitations = (s: string) =>
  s
    .replace(/\u3010[\s\S]*?\u3011/g, "") // 【 ... 】
    .replace(/\[\d+:[^\]]*?\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

// -------- VERY lightweight scope heuristic (fast, no extra API call) ---
function isInScope(msg: string): boolean {
  const s = (msg || "").toLowerCase();

  // Strong indicators (model name / sheets / flows)
  const strong = [
    "hairbar", "hair bar", "haibar", // typos/variants
    "conto economico", "cash flow", "flusso di cassa", "stato patrimoniale",
    "scenario builder", "dashboard", "report", "foglio", "sheet", "workbook",
    "excel", "formula", "celle", "macro", "piano finanziario",
    "ricavi", "costi", "capex", "depre", "ammortament", "tfr", "oic", "ifrs",
    "working capital", "fornitori", "magazzino", "inventario", "debiti", "crediti",
  ];
  if (strong.some(k => s.includes(k))) return true;

  // Generic finance/model words + question verbs (helps short queries)
  const maybe = [
    "modello", "model", "finanziar", "conto", "cassa", "bilancio", "price", "prezzo", "volume",
    "iva", "vat", "costo", "margine", "budget", "forecast", "scenario",
  ];
  const verbs = ["come", "dove", "in quale", "which", "how", "where", "update", "imposta", "aggiorna", "calcola"];
  const hitMaybe = maybe.some(k => s.includes(k));
  const hitVerb = verbs.some(v => s.includes(v));
  return hitMaybe && hitVerb;
}

// -------- Decide when to replace answer with contact info ---------------
function shouldUseContactFallback(text: string): boolean {
  const t = (text || "").toLowerCase().trim();
  if (!t) return true;                                  // empty = fallback
  // Common “can’t answer” phrases (IT/EN)
  const unsure = [
    "non sono in grado", "non dispongo", "non posso rispondere",
    "non ho informazioni sufficienti", "non riesco a trovare",
    "i'm not able", "i cannot answer", "i don't have enough information",
    "i don't have sufficient information", "unable to answer",
  ];
  return unsure.some(p => t.includes(p));
}

// -------- Wait for a run to finish -------------------------------------
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

// -------- Extract only text parts from the newest assistant message -----
const getAssistantText = (msg: any): string => {
  if (!msg?.content) return "";
  const out: string[] = [];
  for (const c of msg.content) {
    if (c && c.type === "text" && c.text && typeof c.text.value === "string") out.push(c.text.value);
    else if (c && c.type === "output_text" && typeof c.text === "string") out.push(c.text);
  }
  return stripCitations(out.join("\n\n"));
};

// ----------------------------- ROUTE -----------------------------------
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

    // --- PRE-FILTER: block unrelated queries before hitting the Assistant ---
    if (!isInScope(message)) {
      // Short, polite refusal + redirect to Studio Bellanti
      return NextResponse.json(
        {
          ok: true,
          text:
            "Sono focalizzato esclusivamente sul modello HairBar (struttura, logiche, report e utilizzo in Excel). " +
            contactLine,
        },
        { status: 200 }
      );
    }

    // --- Add user message to the thread ---
    await client.beta.threads.messages.create(thread_id, {
      role: "user",
      content: message,
    });

    // --- Create run with extra guardrails (re-enforces scope on the model) ---
    const run = await client.beta.threads.runs.create(thread_id, {
      assistant_id,
      additional_instructions: `
Stay strictly within the HairBar model scope (sheets, calculations, inputs/outputs, workflows). 
If the documentation does not support a confident answer, do NOT guess; return a concise refusal and invite the user to contact Studio Bellanti at info@studiobellanti.com or their usual phone number. 
Never include raw file names/paths/IDs or bracketed citations (e.g., 【12:...】) in the final text. 
Answer in the user's language and be concise (lists/steps when helpful).`.trim(),
    });

    await waitForRun(thread_id, run.id);

    // --- Newest assistant message only ---
    const list = await client.beta.threads.messages.list(thread_id, { order: "desc", limit: 10 });
    const latestAssistant = list.data.find((m) => m.role === "assistant");
    let text = getAssistantText(latestAssistant) || "";

    // --- POST-FILTER: if answer is empty/unsure, show Studio Bellanti contact ---
    if (shouldUseContactFallback(text)) {
      text = contactLine;
    }

    return NextResponse.json({ ok: true, text }, { status: 200 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}
