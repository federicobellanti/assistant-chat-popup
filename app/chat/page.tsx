'use client';
export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Msg = { role: 'user' | 'assistant'; text: string };

// ---- Brand tokens from your palette ----
const BRAND = {
  primary: '#708471',      // user bubble background
  primaryText: '#FFFFFF',
  cta: '#EE7F9C',          // Ask button (your palette)
  surface: '#F8E8EB',      // assistant bubble background
  bg: '#F3F3F3',           // app background
  text: '#121212',
  subtle: '#9AA79B',
  border: '#E5E7EB',
};

// Remove inline KB citations like 
function stripCitations(s: string) {
  try {
    // fullwidth brackets 【 ... 】 and any \[\d+:...]
    return s
      .replace(/\u3010[\s\S]*?\u3011/g, '') // 【 ... 】
      .replace(/\[\d+:[^\]]*?\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  } catch {
    return s;
  }
}

function ChatInner() {
  const p = useSearchParams();
  const assistantId = p.get('assistant_id') || '';
  const threadId = p.get('thread_id') || '';
  const title = p.get('title') || 'AI Assistant';

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ role: 'assistant', text: 'Hi! Ask me anything about your model.' }]);
  }, []);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send() {
    if (!input.trim() || busy) return;
    if (!assistantId || !threadId) { alert('Missing assistant_id or thread_id in URL.'); return; }

    const question = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistant_id: assistantId, thread_id: threadId, message: question }),
      });
      const data = await res.json();
      const answer = data?.ok ? (data.text || '(no text)') : `Error: ${data?.error || 'unknown'}`;
      setMessages(m => [...m, { role: 'assistant', text: stripCitations(answer) }]);
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', text: `Network error: ${e?.message || e}` }]);
    } finally { setBusy(false); }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: BRAND.bg, color: BRAND.text }}>
      {/* Header: logo (left) + title (right). No IDs shown. */}
      <header className="px-3 py-2 shadow bg-white flex items-center justify-between">
        <img src="/logo.png" alt="logo" width={22} height={22} />
        <h1 className="text-base font-semibold" style={{ color: BRAND.text }}>{title}</h1>
      </header>

      {/* Messages */}
      <div ref={boxRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          return (
            <div key={i} className={isUser ? 'text-right' : 'text-left'}>
              <div
                className="inline-block rounded-2xl px-3 py-2 max-w-[95%]"
                style={{
                  background: isUser ? BRAND.primary : BRAND.surface,
                  color: isUser ? BRAND.primaryText : BRAND.text,
                  border: isUser ? 'none' : `1px solid ${BRAND.border}`,
                }}
              >
                <div className="text-[11px] mb-1" style={{ color: isUser ? 'rgba(255,255,255,0.85)' : BRAND.subtle }}>
                  {isUser ? 'you' : 'assistant'}
                </div>
                <div className="whitespace-pre-wrap text-[15px] leading-6">{m.text}</div>
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="text-left">
            <span className="italic text-sm" style={{ color: BRAND.subtle }}>thinking…</span>
          </div>
        )}
      </div>

      {/* Composer: textarea fills the row; Ask button tall & same height */}
      <div className="p-2 bg-white border-t" style={{ borderColor: BRAND.border }}>
        <div className="flex gap-2 items-stretch">
          <textarea
            className="flex-1 rounded-xl border px-3 py-2"
            rows={4}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type your question…"
            style={{
              borderColor: BRAND.border,
              fontSize: 15,
              lineHeight: '22px',
              minHeight: 96,          // taller input
              resize: 'vertical',
            }}
          />
          <button
            onClick={send}
            disabled={busy}
            className="rounded-xl px-4 text-base font-medium h-full"
            style={{
              background: BRAND.cta,
              color: '#FFFFFF',
              boxShadow: '0 1px 2px rgba(0,0,0,.12)',
              width: 96,              // fixed CTA width, rest is textarea
              opacity: busy ? 0.6 : 1,
            }}
            title="Ask (Enter to send; Shift+Enter for newline)"
          >
            Ask
          </button>
        </div>
        <div className="text-[11px] mt-1" style={{ color: BRAND.subtle }}>
          Press Enter to send • Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>Loading…</div>}>
      <ChatInner />
    </Suspense>
  );
}
