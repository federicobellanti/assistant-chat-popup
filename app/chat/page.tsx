'use client';
export const dynamic = 'force-dynamic';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; text: string };

export default function ChatPage() {
  const p = useSearchParams();
  const assistantId = p.get('assistant_id') || '';
  const threadId = p.get('thread_id') || '';
  const title = p.get('title') || 'Model Assistant';

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([{ role: 'assistant', text: 'Hi! Ask me anything about your model.' }]); }, []);
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  async function send() {
    if (!input.trim() || busy) return;
    if (!assistantId || !threadId) { alert('Missing assistant_id or thread_id in URL.'); return; }

    const question = input.trim();
    setInput(''); setMessages(m => [...m, { role: 'user', text: question }]); setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistant_id: assistantId, thread_id: threadId, message: question }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', text: data?.ok ? (data.text || '(no text)') : `Error: ${data?.error || 'unknown'}` }]);
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', text: `Network error: ${e?.message || e}` }]);
    } finally { setBusy(false); }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="px-4 py-3 shadow bg-white">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-xs text-gray-500">Assistant: {assistantId} • Thread: {threadId}</p>
      </header>
      <div ref={boxRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block rounded-2xl px-3 py-2 max-w-[80%] ${m.role === 'user' ? 'bg-blue-100' : 'bg-white border'}`}>
              <div className="text-xs mb-1 text-gray-500">{m.role}</div>
              <div className="whitespace-pre-wrap text-sm">{m.text}</div>
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-gray-400">Thinking…</div>}
      </div>
      <div className="p-3 bg-white border-t flex gap-2">
        <textarea className="flex-1 border rounded-xl p-2 text-sm" rows={2}
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
          placeholder="Type your question…"/>
        <button className="px-3 py-2 rounded-xl bg-black text-white text-sm disabled:opacity-50"
          disabled={busy} onClick={send}>Send</button>
      </div>
    </div>
  );
}
