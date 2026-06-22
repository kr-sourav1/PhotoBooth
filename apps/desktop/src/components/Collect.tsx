import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  collectSelected,
  getSelectedUuids,
  listCollectableProjects,
  markCollected,
  type CollectableProject,
  type CollectReport,
} from '../lib/api.js';

// Per-project manifest, written under the originals folder during preview generation.
const manifestPathFor = (originalsDir: string, projectId: string) =>
  `${originalsDir}/.photobooth-previews/${projectId}/manifest.photobooth.sqlite`;

export function Collect({ refreshKey }: { refreshKey: number }) {
  const [projects, setProjects] = useState<CollectableProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<CollectableProject | null>(null);
  const [originalsDir, setOriginalsDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CollectReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listCollectableProjects()
      .then(setProjects)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  // Reload when mounted and whenever a realtime submission bumps refreshKey.
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function pickOriginals() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === 'string') setOriginalsDir(dir);
  }

  async function run() {
    if (!selectedProject || !originalsDir) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const uuids = await getSelectedUuids(selectedProject.id);
      if (uuids.length === 0) throw new Error('No selection found for this project.');
      const manifestPath = manifestPathFor(originalsDir, selectedProject.id);
      const result = await collectSelected(manifestPath, uuids, originalsDir);
      setReport(result);
      if (result.unmatched.length === 0) {
        await markCollected(selectedProject.id);
        load();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted">
        Pull the high-res originals your client selected into a <code>Selected Photos</code> folder.
        Choose the same originals folder you generated previews from (it holds the local manifest).
      </p>

      {projects.length === 0 && <p className="muted">No client selections waiting yet.</p>}

      {projects.map((p) => (
        <div
          key={p.id}
          className="row"
          style={{
            justifyContent: 'space-between',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: '8px 12px',
            background: selectedProject?.id === p.id ? 'rgba(37,99,235,0.08)' : 'transparent',
          }}
        >
          <span>
            <strong>{p.name}</strong>
            {p.clientName ? ` — ${p.clientName}` : ''}{' '}
            <span className="muted">({p.photoCount} photos)</span>
          </span>
          <button
            className="btn"
            style={{ background: '#6b7280' }}
            onClick={() => {
              setSelectedProject(p);
              setReport(null);
              setError(null);
            }}
          >
            {selectedProject?.id === p.id ? 'Selected' : 'Choose'}
          </button>
        </div>
      ))}

      {selectedProject && (
        <>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={pickOriginals} disabled={busy}>
              Choose originals folder
            </button>
            {originalsDir && <code>{originalsDir}</code>}
          </div>
          <div className="row">
            <button className="btn" onClick={run} disabled={!originalsDir || busy}>
              {busy ? 'Collecting…' : `Collect "${selectedProject.name}" selection`}
            </button>
          </div>
        </>
      )}

      {report && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: '#16a34a' }}>
            ✅ Copied {report.copied} originals
            {report.skipped_existing > 0 && `, ${report.skipped_existing} already present`} →{' '}
            <code>{report.output_dir}</code>
          </p>
          {report.unmatched.length > 0 && (
            <p style={{ color: '#d97706' }}>
              ⚠️ {report.unmatched.length} selected photo(s) had no matching original in this folder.
              Make sure you picked the folder used to generate previews.
            </p>
          )}
        </div>
      )}
      {error && <p style={{ color: '#ef4444' }}>⚠️ {error}</p>}
    </div>
  );
}
