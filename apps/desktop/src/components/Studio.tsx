import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { supabase } from '../lib/supabase.js';
import {
  createProject,
  ensureShareLink,
  getStudioId,
  subscribeToSubmissions,
  uploadAndRecord,
  type PreviewResult,
  type SyncProgress,
} from '../lib/api.js';
import { Collect } from './Collect.js';
import { Projects } from './Projects.js';

type Mode = 'upload' | 'projects' | 'collect';

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
  const [watermark, setWatermark] = useState('');
  const [sourceDir, setSourceDir] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [gen, setGen] = useState<Progress | null>(null);
  const [up, setUp] = useState<{ done: number; total: number } | null>(null);
  const [phase, setPhase] = useState<SyncProgress['phase'] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('upload');
  const [refreshKey, setRefreshKey] = useState(0);
  const [newSubmission, setNewSubmission] = useState(false);

  useEffect(() => {
    getStudioId().then(setStudioId).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  // Realtime: when a client submits a selection, badge the Collect tab and refresh its list.
  useEffect(() => {
    if (!studioId) return;
    return subscribeToSubmissions(studioId, () => {
      setNewSubmission(true);
      setRefreshKey((k) => k + 1);
    });
  }, [studioId]);

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
        watermark: watermark.trim() || null,
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

      // 4. Create the shareable client gallery link.
      const link = await ensureShareLink(projectId);
      setShareLink(link);
      setCopied(false);

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
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn"
          style={{ background: mode === 'upload' ? '#2563eb' : '#9ca3af' }}
          onClick={() => setMode('upload')}
        >
          1 · Upload previews
        </button>
        <button
          className="btn"
          style={{ background: mode === 'projects' ? '#2563eb' : '#9ca3af' }}
          onClick={() => setMode('projects')}
        >
          Projects
        </button>
        <button
          className="btn"
          style={{ background: mode === 'collect' ? '#2563eb' : '#9ca3af' }}
          onClick={() => {
            setMode('collect');
            setNewSubmission(false);
          }}
        >
          2 · Collect selections{newSubmission ? ' 🔴' : ''}
        </button>
      </div>

      {mode === 'collect' ? (
        <Collect refreshKey={refreshKey} />
      ) : mode === 'projects' ? (
        <Projects refreshKey={refreshKey} />
      ) : (
        <>
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

      <div className="row" style={{ display: 'block' }}>
        <input
          placeholder="Watermark text (optional, e.g. PREVIEW — Sharma Photography)"
          value={watermark}
          onChange={(e) => setWatermark(e.target.value)}
          style={{ width: '100%', maxWidth: 420, padding: 10 }}
          disabled={busy}
        />
        <p className="muted" style={{ marginTop: 4 }}>
          Leave blank for no watermark. Supports JPG, PNG, TIFF, HEIC and RAW (CR2/NEF/ARW/DNG…).
        </p>
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
      {shareLink && (
        <div className="row" style={{ display: 'block' }}>
          <p className="muted" style={{ marginBottom: 4 }}>Client gallery link — send this to your client:</p>
          <div className="row">
            <code style={{ flex: 1, wordBreak: 'break-all' }}>{shareLink}</code>
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(shareLink);
                setCopied(true);
              }}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}
        </>
      )}
      {error && <p style={{ color: '#ef4444' }}>⚠️ {error}</p>}
    </div>
  );
}
