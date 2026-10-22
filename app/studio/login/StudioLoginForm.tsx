'use client';

import { useActionState } from 'react';
import { memberLogin, type MemberLoginState } from './actions';
import Masthead from '../../Masthead';

export default function StudioLoginForm({ studio, name, line }: { studio: string; name: string; line: string }) {
  const [state, action, pending] = useActionState<MemberLoginState, FormData>(memberLogin, {});
  return (
    <form action={action} className="card login">
      <Masthead section={name} title="Welcome back." standfirst={line} />
      <input type="hidden" name="studio" value={studio} />
      <label>
        Username
        <input name="username" autoComplete="username" required autoFocus defaultValue={state.username} key={state.username} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
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
