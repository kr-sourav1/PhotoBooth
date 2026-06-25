import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.js';
import {
  createStudio,
  generatePassword,
  listStudios,
  resetPassword,
  type StudioRow,
} from '../lib/api.js';

export function Dashboard({ session }: { session: Session }) {
  const [studios, setStudios] = useState<StudioRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // create form
  const [studioName, setStudioName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const load = useCallback(() => {
    listStudios()
      .then(setStudios)
      .catch((e) => setLoadErr(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormErr(null);
    setCreated(null);
    try {
      await createStudio(studioName.trim(), ownerEmail.trim(), ownerName.trim(), password);
      setCreated({ email: ownerEmail.trim(), password });
      setStudioName('');
      setOwnerName('');
      setOwnerEmail('');
      setPassword(generatePassword());
      load();
    } catch (e) {
      setFormErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onReset(s: StudioRow) {
    const owner = s.users.find((u) => u.role === 'owner') ?? s.users[0];
    if (!owner) return;
    const np = generatePassword();
    if (!confirm(`Reset password for ${owner.email} to:\n\n${np}\n\nProceed?`)) return;
    try {
      await resetPassword(owner.id, np);
      alert(`New password for ${owner.email}:\n\n${np}\n\nGive this to the studio.`);
    } catch (e) {
      alert(`Failed: ${String((e as Error)?.message ?? e)}`);
    }
  }

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>PhotoBooth — Admin</h1>
        <div className="row">
          <span className="muted">{session.user.email}</span>
          <button className="btn gray" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>

      {/* Create studio */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Create a studio (for a paying customer)</h2>
        <form onSubmit={onCreate}>
          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <label>Studio name</label>
              <input value={studioName} onChange={(e) => setStudioName(e.target.value)} style={{ width: '100%' }} placeholder="Sharma Photography" required />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label>Owner name</label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} style={{ width: '100%' }} placeholder="Rohit Sharma" />
            </div>
          </div>
          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <label>Owner login email</label>
              <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} style={{ width: '100%' }} placeholder="studio@example.com" required />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label>Password (give to the studio)</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: 1 }} required />
                <button type="button" className="btn gray" onClick={() => setPassword(generatePassword())}>↻</button>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create studio'}
            </button>
          </div>
        </form>
        {formErr && <p className="err">⚠️ {formErr}</p>}
        {created && (
          <p className="ok">
            ✅ Studio created. Hand these to the customer:<br />
            Login: <code>{created.email}</code> &nbsp; Password: <code>{created.password}</code>
          </p>
        )}
      </div>

      {/* Studios list */}
      <h2>Studios ({studios.length})</h2>
      {loadErr && <p className="err">⚠️ {loadErr}</p>}
      {studios.length === 0 && !loadErr && <p className="muted">No studios yet.</p>}
      {studios.map((s) => {
        const owner = s.users.find((u) => u.role === 'owner') ?? s.users[0];
        const projects = s.projects?.[0]?.count ?? 0;
        return (
          <div key={s.id} className="studio">
            <span>
              <strong>{s.name}</strong>{' '}
              <span className="muted">· {owner?.email ?? 'no owner'} · {s.plan} · {projects} projects</span>
            </span>
            <button className="btn gray" onClick={() => onReset(s)}>Reset password</button>
          </div>
        );
      })}
    </div>
  );
}
