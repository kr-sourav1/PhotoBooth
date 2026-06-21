import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

type View = 'signin' | 'signup';

export function Login() {
  const [view, setView] = useState<View>('signin');
  const [studioName, setStudioName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (view === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { studio_name: studioName.trim() || `${email.split('@')[0]}'s Studio` } },
      });
      if (error) setError(error.message);
      else if (!data.session) {
        // Email confirmation required (no immediate session).
        setNotice('Account created. Check your email to confirm, then sign in.');
        setView('signin');
      }
      // If a session exists, onAuthStateChange in App will switch to the Studio view.
    }
    setBusy(false);
  }

  const isSignup = view === 'signup';

  return (
    <div className="app">
      <h1>PhotoBooth Studio</h1>
      <p className="muted">
        {isSignup ? 'Create your studio account.' : 'Sign in to your studio account.'}
      </p>

      <form onSubmit={submit} style={{ maxWidth: 360 }}>
        <div className="row" style={{ display: 'block' }}>
          {isSignup && (
            <input
              placeholder="Studio name (e.g. Sharma Photography)"
              value={studioName}
              onChange={(e) => setStudioName(e.target.value)}
              style={{ width: '100%', padding: 10, marginBottom: 8 }}
            />
          )}
          <input
            type="email"
            placeholder="you@studio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: 10, marginBottom: 8 }}
            required
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            style={{ width: '100%', padding: 10 }}
            required
          />
        </div>

        {error && <p style={{ color: '#ef4444' }}>{error}</p>}
        {notice && <p style={{ color: '#16a34a' }}>{notice}</p>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="muted" style={{ marginTop: 16 }}>
        {isSignup ? 'Already have an account?' : 'New here?'}{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView(isSignup ? 'signin' : 'signup');
            setError(null);
            setNotice(null);
          }}
          style={{ color: '#2563eb' }}
        >
          {isSignup ? 'Sign in' : 'Create a studio account'}
        </a>
      </p>
    </div>
  );
}
