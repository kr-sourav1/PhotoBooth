import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { supabase } from '../lib/supabase.js';
import {
  createProject,
  getStudioId,
  uploadAndRecord,
  type PreviewResult,
  type SyncProgress,
} from '../lib/api.js';

interface GenerateOutput {
  manifest_path: string;
  photos: PreviewResult[];
  failures: string[];
}
interface Progress {
  done: number;
  total: number;
  current: string;
}

type Stage = 'idle' | 'generating' | 'uploading' | 'done';

export function Studio({ session }: { session: Session }) {
  const [studioId, setStudioId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [sourceDir, setSourceDir] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [gen, setGen] = useState<Progress | null>(null);
  const [up, setUp] = useState<{ done: number; total: number } | null>(null);
  const [phase, setPhase] = useState<SyncProgress['phase'] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStudioId().then(setStudioId).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    const a = listen<Progress>('preview-progress', (e) => setGen(e.payload));
    const b = listen<{ done: number; total: number }>('upload-progress', (e) => setUp(e.payload));
    return () => {
      a.then((f) => f());
      b.then((f) => f());
    };
  }, []);

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === 'string') setSourceDir(dir);
  }

  async function run() {
    if (!studioId || !sourceDir || !projectName.trim()) return;
    setError(null);
    setSummary(null);
    setGen(null);
    setUp(null);
    try {
      // 1. Create the project (cloud).
      const projectId = await createProject(projectName.trim());

      // 2. Generate previews locally (Rust). Originals never leave this machine.
      setStage('generating');
      const previewDir = `${sourceDir}/.photobooth-previews`;
      const out = await invoke<GenerateOutput>('generate_previews', {
        sourceDir,
        outputDir: previewDir,
        maxEdge: 1600,
        jpegQuality: 80,
      });

      // 3. Upload previews to R2 + record photo rows (cloud).
      setStage('uploading');
      const report = await uploadAndRecord(
        studioId,
        projectId,
        previewDir,
        out.photos,
        (p) => setPhase(p.phase),
      );

      setStage('done');
      setSummary(
        `Project "${projectName.trim()}" ready: ${report.uploaded} previews uploaded` +
          `${report.failures.length ? `, ${report.failures.length} failed` : ''}` +
          `${out.failures.length ? `, ${out.failures.length} skipped (unreadable)` : ''}.`,
      );
    } catch (e: unknown) {
      setStage('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const genPct = gen?.total ? Math.round((gen.done / gen.total) * 100) : 0;
  const upPct = up?.total ? Math.round((up.done / up.total) * 100) : 0;
  const busy = stage === 'generating' || stage === 'uploading';

  return (
    <div className="app">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>PhotoBooth Studio</h1>
        <button className="btn" style={{ background: '#6b7280' }} onClick={() => supabase.auth.signOut()}>
          Sign out ({session.user.email})
        </button>
      </div>
      <p className="muted">
        Create a project, then generate &amp; upload previews. Only previews are uploaded — your
        high-res originals stay on this machine.
      </p>

      <div className="row" style={{ display: 'block' }}>
        <input
          placeholder="Project name (e.g. Sharma Wedding)"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          style={{ width: '100%', maxWidth: 420, padding: 10 }}
          disabled={busy}
        />
      </div>

      <div className="row">
        <button className="btn" onClick={pickFolder} disabled={busy}>
          Choose originals folder
        </button>
        {sourceDir && <code>{sourceDir}</code>}
      </div>

      <div className="row">
        <button
          className="btn"
          onClick={run}
          disabled={!studioId || !sourceDir || !projectName.trim() || busy}
        >
          {busy ? 'Working…' : 'Generate & upload previews'}
        </button>
      </div>

      {gen && (
        <div>
          <p className="muted">Generating previews — {gen.done}/{gen.total}</p>
          <div className="bar"><span style={{ width: `${genPct}%` }} /></div>
        </div>
      )}
      {(stage === 'uploading' || up) && (
        <div style={{ marginTop: 12 }}>
          <p className="muted">
            {phase === 'signing' && 'Requesting upload URLs…'}
            {phase === 'uploading' && up && `Uploading previews — ${up.done}/${up.total}`}
            {phase === 'recording' && 'Recording photos…'}
          </p>
          <div className="bar"><span style={{ width: `${upPct}%` }} /></div>
        </div>
      )}

      {summary && <p style={{ color: '#16a34a' }}>✅ {summary}</p>}
      {error && <p style={{ color: '#ef4444' }}>⚠️ {error}</p>}
    </div>
  );
}
