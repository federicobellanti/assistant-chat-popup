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

// -------- Extract only text parts from the newest assistant message -----
const getAssistantText = (msg: any): string => {
  if (!msg?.content) return "";
  const out: string[] = [];
  for (const c of msg.content) {
    if (c?.type === "text" && typeof c?.text?.value === "string") {
      out.push(c.text.value);
    }
  }
  return stripCitations(out.join("\n\n"));
};

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

/* =========================
   S T A G E   A : Heuristic
   ========================= */
const STRONG_TERMS = [
  // model / sheets / reports (IT/EN)
  "hairbar", "hair bar", "haibar",
  "conto economico", "cash flow", "flusso di cassa", "stato patrimoniale",
  "scenario builder", "dashboard", "report", "reporting",
  "foglio", "sheet", "workbook", "excel", "macro",
  "aggiorna report", "recalc", "recalcolo",
  // finance/accounting
  "ricavi", "revenues", "fatturato", "costi", "capex",
  "ammortament", "depreciat", "tfr", "oic", "ifrs",
  "working capital", "capitale circolante", "fornitori", "clienti",
  "magazzino", "inventario", "debiti", "crediti",
  // inputs/actions typical in model
  "prezzo", "price", "quantità", "volume", "assunzioni", "assumptions",
  "parametri", "inputs", "impostazioni", "settings", "driver",
];

const MAYBE_TERMS = [
  "modello", "model", "finanziar", "financial", "budget", "forecast", "scenario",
  "iva", "vat", "margine", "margins", "costo", "costi", "price", "prezzo", "volume",
  "alloca", "allocate", "imposta", "set", "aggiorna", "update", "inserire", "enter",
  "simula", "simulate", "simulare", "simulazione", "aumento", "increase", "riduzione", "decrease",
];

const VERB_TRIGGERS = [
  "come", "dove", "quale", "qual è", "which", "how", "where",
  "update", "imposta", "inserire", "enter", "modific", "change", "simula", "simulate",
];

// very small helper: does text contain any token from list
function hasAny(text: string, list: string[]) {
  const s = text;
  return list.some((k) => s.includes(k));
}

// Heuristic: be permissive; assume follow-ups are in-scope if recent context is model-related
function heuristicInScope(msg: string, recentContext: string): boolean {
  const s = (msg || "").toLowerCase();

  // 1) Direct strong match in the message
  if (hasAny(s, STRONG_TERMS)) return true;

  // 2) Message has finance/model terms + action verbs
  if (hasAny(s, MAYBE_TERMS) && hasAny(s, VERB_TRIGGERS)) return true;

  // 3) Follow-up logic:
  //    If recent context is clearly model-related, allow generic follow-ups
  //    only when current message shows some intent (verbs) or finance terms.
  const recent = (recentContext || "").toLowerCase();
  const recentLooksModel = hasAny(recent, STRONG_TERMS) || hasAny(recent, MAYBE_TERMS);
  if (recentLooksModel && (hasAny(s, VERB_TRIGGERS) || hasAny(s, MAYBE_TERMS))) {
    return true;
  }

  // No artificial prefixing with "hairbar" — avoid smuggling keywords.
  return false;
}


// pull last few messages to detect follow-up context (cheap)
async function recentThreadText(threadId: string): Promise<string> {
  try {
    const page = await client.beta.threads.messages.list(threadId, { order: "desc", limit: 6 });
    const bits: string[] = [];
    for (const msg of page.data) {
      if (!msg?.content) continue;
      for (const c of msg.content) {
        if (c?.type === "text" && typeof c?.text?.value === "string") {
          bits.push(c.text.value.toLowerCase());
        }
      }
    }
    return bits.join(" ");
  } catch {
    return "";
  }
}

/* =========================
   S T A G E   B : LLM check
   ========================= */
// Only used when Stage A says out-of-scope
async function llmScopeCheck(message: string, recentContext: string): Promise<boolean> {
  try {
    const prompt =
      `Decidi se la richiesta è in ambito "uso e funzionamento del modello Excel HairBar" (finanza, rendiconti, fogli, input, simulazioni, ` +
      `assunzioni, ricavi/costi, tasti/macro, navigazione). Considera anche il contesto recente.\n` +
      `Rispondi SOLO con "IN" o "OUT".\n\n` +
      `Contesto recente:\n${recentContext?.slice(0, 2000) || "(vuoto)"}\n\n` +
      `Richiesta:\n${message}`;

    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: "Sei un classificatore binario. Output solo 'IN' o 'OUT'." },
        { role: "user", content: prompt },
      ],
    });

    const out = (res.choices?.[0]?.message?.content || "").trim().toUpperCase();
    return out.includes("IN");
  } catch {
    // Safety net: on any error, allow instead of blocking
    return true;
  }
}

/* =========================
   R O U T E
   ========================= */
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

    // === PRE-FILTER (Stage A + Stage B) ===
    const recent = await recentThreadText(thread_id);
    let inScope = heuristicInScope(message, recent);
    if (!inScope) {
      inScope = await llmScopeCheck(message, recent);
    }

    if (!inScope) {
      // Polite refusal + Studio Bellanti contact
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
    const t = text.toLowerCase().trim();
    const unsure = [
      "non sono in grado", "non dispongo", "non posso rispondere",
      "non ho informazioni sufficienti", "non riesco a trovare",
      "i'm not able", "i cannot answer", "i don't have enough information",
      "i don't have sufficient information", "unable to answer",
    ];
    if (!t || unsure.some((p) => t.includes(p))) {
      text = contactLine;
    }

    return NextResponse.json({ ok: true, text }, { status: 200 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}
