'use client';
import { useEffect, useState } from 'react';

export default function Launch() {
  const [status, setStatus] = useState<'idle'|'opened'|'blocked'>('idle');
  const [chatUrl, setChatUrl] = useState<string>('');
  const [features, setFeatures] = useState<string>('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const assistantId = p.get('assistant_id') || '';
    const threadId = p.get('thread_id') || '';
    const title = p.get('title') || 'AI Assistant';

    // Default popup size per your spec; allow optional overrides via ?w=&h=
    const w = Number(p.get('w') || 420);
    const h = Number(p.get('h') || 640);

    // Center on screen
    const x = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const y = window.screenY + Math.max(0, (window.outerHeight - h) / 2);

    const url = `/chat?assistant_id=${encodeURIComponent(assistantId)}&thread_id=${encodeURIComponent(threadId)}&title=${encodeURIComponent(title)}`;
    setChatUrl(url);

    const feat =
      `popup=yes,width=${w},height=${h},left=${Math.round(x)},top=${Math.round(y)},` +
      `menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
    setFeatures(feat);

    const popup = window.open(url, 'assistant_popup', feat);
    if (popup && !popup.closed) {
      popup.focus?.();
      setStatus('opened');
    } else {
      setStatus('blocked');
    }
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
      {status === 'idle' && <p>Attempting to open…</p>}
    </div>
  );
}
