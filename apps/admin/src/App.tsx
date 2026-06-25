import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase.js';
import { Login } from './components/Login.js';
import { Dashboard } from './components/Dashboard.js';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="wrap"><p className="muted">Loading…</p></div>;
  return session ? <Dashboard session={session} /> : <Login />;
}
