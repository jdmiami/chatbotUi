'use client';

import { useActionState } from 'react';
import { login, type LoginState } from './actions';

export default function LoginForm({ needsCode }: { needsCode: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="card">
      <div className="brand">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <h1>Remote Desktop</h1>
      </div>
      <p className="muted">Sign in to connect to your PC.</p>

      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          required
          autoFocus
          defaultValue={state.username}
          key={state.username}
        />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {needsCode && (
        <label>
          Authenticator code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            placeholder="123 456"
            required
          />
        </label>
      )}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
