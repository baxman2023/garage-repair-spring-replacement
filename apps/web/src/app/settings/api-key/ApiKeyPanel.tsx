'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

export function ApiKeyPanel() {
  const status = trpc.apiKey.status.useQuery();
  const [key, setKey] = useState('');
  const utils = trpc.useUtils();

  const set = trpc.apiKey.set.useMutation({
    onSuccess: () => {
      setKey('');
      void utils.apiKey.status.invalidate();
    },
  });
  const test = trpc.apiKey.test.useMutation({
    onSuccess: () => void utils.apiKey.status.invalidate(),
  });
  const remove = trpc.apiKey.remove.useMutation({
    onSuccess: () => void utils.apiKey.status.invalidate(),
  });

  const inputStyle = {
    padding: '0.6rem',
    borderRadius: 6,
    border: '1px solid #333',
    background: '#12151c',
    color: 'var(--fg)',
    minWidth: 320,
  };
  const btn = {
    padding: '0.5rem 0.9rem',
    borderRadius: 6,
    border: 'none',
    background: 'var(--accent)',
    color: '#04122e',
    fontWeight: 600,
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 520 }}>
      <div>
        <strong>Status:</strong>{' '}
        {status.isPending ? (
          '…'
        ) : status.data?.configured ? (
          <span>
            Key ending <code>{status.data.last4}</code> —{' '}
            {status.data.verifiedAt ? (
              <span style={{ color: 'var(--ok)' }}>verified</span>
            ) : (
              <span style={{ color: 'salmon' }}>not verified</span>
            )}
          </span>
        ) : (
          <span style={{ color: 'var(--muted)' }}>no key configured</span>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          set.mutate({ key });
        }}
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
      >
        <input
          type="password"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          style={inputStyle}
        />
        <button type="submit" disabled={set.isPending} style={btn}>
          {set.isPending ? 'Saving…' : 'Save key'}
        </button>
      </form>
      {set.isError && <p style={{ color: 'salmon' }}>{set.error.message}</p>}

      {status.data?.configured && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => test.mutate()} disabled={test.isPending} style={btn}>
            {test.isPending ? 'Testing…' : 'Test key'}
          </button>
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            style={{ ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' }}
          >
            Remove
          </button>
        </div>
      )}
      {test.data && (
        <p style={{ color: test.data.ok ? 'var(--ok)' : 'salmon' }}>
          {test.data.ok ? 'Key verified.' : `Test failed: ${test.data.error}`}
        </p>
      )}
    </div>
  );
}
