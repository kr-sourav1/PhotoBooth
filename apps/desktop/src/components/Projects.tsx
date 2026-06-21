import { useCallback, useEffect, useState } from 'react';
import {
  deleteProject,
  ensureShareLink,
  listAllProjects,
  type ProjectSummary,
} from '../lib/api.js';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  previews_uploading: 'Uploading…',
  awaiting_selection: 'Awaiting selection',
  selection_submitted: 'Selection submitted',
  collected: 'Collected',
  archived: 'Archived',
};

export function Projects({ refreshKey }: { refreshKey: number }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(() => {
    listAllProjects()
      .then(setProjects)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function copyLink(id: string) {
    try {
      const link = await ensureShareLink(id);
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  async function remove(id: string) {
    try {
      await deleteProject(id);
      setConfirmId(null);
      load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  return (
    <div>
      <p className="muted">All your projects. Copy a client link or delete a project.</p>
      {projects.length === 0 && <p className="muted">No projects yet — create one from the Upload tab.</p>}

      {projects.map((p) => (
        <div
          key={p.id}
          className="row"
          style={{
            justifyContent: 'space-between',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 8,
          }}
        >
          <span>
            <strong>{p.name}</strong>
            {p.clientName ? ` — ${p.clientName}` : ''}{' '}
            <span className="muted">
              · {STATUS_LABEL[p.status] ?? p.status} · {p.photoCount} photos
            </span>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn" disabled={!p.photoCount} onClick={() => copyLink(p.id)}>
              {copiedId === p.id ? 'Copied ✓' : 'Copy link'}
            </button>
            {confirmId === p.id ? (
              <>
                <button className="btn" style={{ background: '#ef4444' }} onClick={() => remove(p.id)}>
                  Confirm delete
                </button>
                <button className="btn" style={{ background: '#6b7280' }} onClick={() => setConfirmId(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn" style={{ background: '#9ca3af' }} onClick={() => setConfirmId(p.id)}>
                Delete
              </button>
            )}
          </span>
        </div>
      ))}

      {error && <p style={{ color: '#ef4444' }}>⚠️ {error}</p>}
    </div>
  );
}
