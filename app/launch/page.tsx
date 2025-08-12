'use client';
import { useEffect, useState } from 'react';

export default function Launch() {
  const [status, setStatus] = useState<'idle'|'opened'|'blocked'>('idle');
  const [chatUrl, setChatUrl] = useState<string>('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const assistantId = p.get('assistant_id') || '';
    const threadId = p.get('thread_id') || '';
    const title = p.get('title') || 'Model Assistant';

    const url = `/chat?assistant_id=${encodeURIComponent(assistantId)}&thread_id=${encodeURIComponent(threadId)}&title=${encodeURIComponent(title)}`;
    setChatUrl(url);

    // Try to open immediately (may be blocked if not a user gesture)
    const w = 430, h = 640;
    const x = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const y = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(url, 'assistant_popup',
      `popup=yes,width=${w},height=${h},left=${x},top=${y},resizable=yes`
    );

    if (popup && !popup.closed) {
      setStatus('opened');
      // Do NOT auto-close this tab; Excel launches may not count as user gestures.
      // Users can close this tab manually.
    } else {
      setStatus('blocked');
    }
  }, []);

  function openManually() {
    const w = 430, h = 640;
    const x = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const y = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(chatUrl, 'assistant_popup',
      `popup=yes,width=${w},height=${h},left=${x},top=${y},resizable=yes`
    );
    if (popup && !popup.closed) {
      setStatus('opened');
    } else {
      setStatus('blocked');
      alert('Popup blocked. Please allow popups for this site and try again.');
    }
  }

  return (
    <div style={{padding: 16, fontFamily: 'system-ui, sans-serif'}}>
      <h1 style={{marginTop:0}}>Launching chat…</h1>
      {status === 'opened' && (
        <p>Popup opened. You can close this tab whenever you like.</p>
      )}
      {status === 'blocked' && (
        <>
          <p>It looks like your browser blocked the popup.</p>
          <button onClick={openManually} style={{padding: '8px 12px', borderRadius: 8, border: '1px solid #000', background: '#000', color: '#fff'}}>
            Open Chat
          </button>
          <p style={{marginTop: 8}}>
            If it still doesn’t open, enable popups for this site and click again.
          </p>
        </>
      )}
      {status === 'idle' && <p>Attempting to open…</p>}
    </div>
  );
}
