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

  return (
    <div className="stack" style={{ maxWidth: 520 }}>
      <div>
        <strong>Status:</strong>{' '}
        {status.isPending ? (
          '…'
        ) : status.data?.configured ? (
          <span>
            Key ending <code>{status.data.last4}</code> —{' '}
            {status.data.verifiedAt ? (
              <span className="badge badge-ok">verified</span>
            ) : (
              <span className="badge badge-danger">not verified</span>
            )}
          </span>
        ) : (
          <span className="muted">no key configured</span>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          set.mutate({ key });
        }}
        className="row"
      >
        <input
          type="password"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="input"
          style={{ minWidth: 320 }}
        />
        <button type="submit" disabled={set.isPending} className="btn btn-primary">
          {set.isPending ? 'Saving…' : 'Save key'}
        </button>
      </form>
      {set.isError && <p className="alert alert-danger">{set.error.message}</p>}

      {status.data?.configured && (
        <div className="row">
          <button onClick={() => test.mutate()} disabled={test.isPending} className="btn btn-primary">
            {test.isPending ? 'Testing…' : 'Test key'}
          </button>
          <button onClick={() => remove.mutate()} disabled={remove.isPending} className="btn">
            Remove
          </button>
        </div>
      )}
      {test.data && (
        <p className={test.data.ok ? 'alert alert-ok' : 'alert alert-danger'}>
          {test.data.ok ? 'Key verified.' : `Test failed: ${test.data.error}`}
        </p>
      )}
    </div>
  );
}
