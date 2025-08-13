'use client';
export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Msg = { role: 'user' | 'assistant'; text: string };

// ---- Brand tokens ----
const BRAND = {
  primary: '#708471',
  primaryText: '#FFFFFF',
  cta: '#EE7F9C',
  surface: '#F8E8EB',
  bg: '#F3F3F3',
  text: '#121212',
  subtle: '#9AA79B',
  border: '#E5E7EB',
};

// Remove inline KB citations like 
function stripCitations(s: string) {
  try {
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: BRAND.bg, color: BRAND.text }}>
      {/* HEADER: force single row with space-between */}
      <header
        style={{
          padding: '8px 12px',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <img
          src="/logo.png"
          alt="logo"
          width={22}
          height={22}
          style={{ display: 'block' }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: BRAND.text,
            whiteSpace: 'nowrap',    // keep title on the same line
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </h1>
      </header>

      {/* MESSAGES */}
      <div ref={boxRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 12px' }}>
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          return (
            <div key={i} style={{ textAlign: isUser ? 'right' : 'left', marginBottom: 8 }}>
              <div
                style={{
                  display: 'inline-block',
                  borderRadius: 16,
                  padding: '8px 12px',
                  maxWidth: '96%',
                  background: isUser ? BRAND.primary : BRAND.surface,
                  color: isUser ? BRAND.primaryText : BRAND.text,
                  border: isUser ? 'none' : `1px solid ${BRAND.border}`,
                }}
              >
                <div style={{ fontSize: 11, marginBottom: 4, color: isUser ? 'rgba(255,255,255,.85)' : BRAND.subtle }}>
                  {isUser ? 'you' : 'assistant'}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: '22px' }}>{m.text}</div>
              </div>
            </div>
          );
        })}
        {busy && (
          <div style={{ textAlign: 'left' }}>
            <span style={{ fontStyle: 'italic', fontSize: 13, color: BRAND.subtle }}>thinking…</span>
          </div>
        )}
      </div>

      {/* COMPOSER: full-width row (textarea grows, button fixed); same height */}
      <div style={{ padding: 8, background: '#fff', borderTop: `1px solid ${BRAND.border}` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 8,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <textarea
            rows={4}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type your question…"
            style={{
              flex: '1 1 auto',   // grow to fill remaining space
              minWidth: 0,        // allow shrinking in flex row (important!)
              borderRadius: 12,
              border: `1px solid ${BRAND.border}`,
              padding: '10px 12px',
              fontSize: 15,
              lineHeight: '22px',
              resize: 'vertical',
              minHeight: 96,
              background: '#fff',
              color: BRAND.text,
            }}
          />
          <button
            onClick={send}
            disabled={busy}
            title="Ask (Enter to send; Shift+Enter for newline)"
            style={{
              width: 108,               // fixed width; textarea uses the rest
              border: 'none',
              borderRadius: 12,
              background: BRAND.cta,
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
              padding: '0 16px',
              boxShadow: '0 1px 2px rgba(0,0,0,.12)',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Ask
          </button>
        </div>
        <div style={{ fontSize: 11, marginTop: 6, color: BRAND.subtle }}>
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
