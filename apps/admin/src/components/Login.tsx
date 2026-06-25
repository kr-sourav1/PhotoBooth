import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="wrap">
      <h1>PhotoBooth — Admin</h1>
      <p className="muted">Platform admin sign in.</p>
      <form onSubmit={signIn} style={{ maxWidth: 340 }}>
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: '100%' }}
          required
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%' }}
          required
        />
        {error && <p className="err">{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
