'use client';

import { useActionState } from 'react';
import { login, type LoginState } from './actions';
import Masthead from '../Masthead';

export default function LoginForm({ needsCode, next = '/' }: { needsCode: boolean; next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="card login">
      <input type="hidden" name="next" value={next} />
      <Masthead section="Sign in" title="Welcome back." standfirst="Your machines, your AI and your desktops, in one place." />

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
      {next === '/' && (
        <p className="login-alt">
          <a href="/login?next=/lite">Or sign in to the fast Make page</a> (plain and quick on a phone).
        </p>
      )}
    </form>
  );
}
