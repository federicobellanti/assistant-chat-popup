'use client';
import { useEffect, useState } from 'react';

export default function Launch() {
  const [status, setStatus] = useState<'idle'|'opened'|'blocked'|'error'>('idle');
  const [chatUrl, setChatUrl] = useState<string>('');
  const [features, setFeatures] = useState<string>('');
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    (async () => {
      const p = new URLSearchParams(window.location.search);
      const token = p.get('token');

      // Default popup size; override via ?w=&h=
      const w = Number(p.get('w') || 420);
      const h = Number(p.get('h') || 640);
      const x = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
      const y = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
      const feat =
        `popup=yes,width=${w},height=${h},left=${Math.round(x)},top=${Math.round(y)},` +
        `menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
      setFeatures(feat);

      try {
        let assistantId = '';
        let threadId = '';
        let title = 'AI Assistant';

        if (token) {
          // Resolve the token server-side for real values
          const res = await fetch(`/api/token/resolve?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
          const data = await res.json();
          if (!data?.ok) throw new Error(data?.error || 'Token resolve failed');
          assistantId = data.assistant_id;
          threadId = data.thread_id;
          title = data.title || title;
        } else {
          // Fallback: explicit ids (legacy)
          assistantId = p.get('assistant_id') || '';
          threadId = p.get('thread_id') || '';
          title = p.get('title') || title;
        }

        if (!assistantId || !threadId) throw new Error('Missing assistant or thread.');

        const url = `/chat?assistant_id=${encodeURIComponent(assistantId)}&thread_id=${encodeURIComponent(threadId)}&title=${encodeURIComponent(title)}`;
        setChatUrl(url);

        const popup = window.open(url, 'assistant_popup', feat);
        if (popup && !popup.closed) {
          popup.focus?.();
          setStatus('opened');
        } else {
          setStatus('blocked');
        }
      } catch (e: any) {
        setErr(e?.message || String(e));
        setStatus('error');
      }
    })();
  }, []);

  function openManually() {
    const win = window.open(chatUrl, 'assistant_popup', features);
    if (win && !win.closed) {
      win.focus?.();
      setStatus('opened');
    } else {
      setStatus('blocked');
      alert('Popup blocked. Please allow popups for this site and try again.');
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>Launching AI Assistant…</h1>
      {status === 'opened' && <p>Popup opened. If you don’t see it, check your taskbar or allow popups.</p>}
      {status === 'blocked' && (
        <>
          <p>Your browser blocked the popup. Click below to open it.</p>
          <button
            onClick={openManually}
            style={{ padding: '8px 12px', borderRadius: 8, background: '#121212', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Open Chat
          </button>
        </>
      )}
      {status === 'error' && <p style={{ color: 'crimson' }}>Could not launch: {err}</p>}
      {status === 'idle' && <p>Attempting to open…</p>}
    </div>
  );
}
