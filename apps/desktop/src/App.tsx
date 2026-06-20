import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

interface PreviewResult {
  uuid: string;
  original_filename: string;
  preview_path: string;
  width: number;
  height: number;
}
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

export function App() {
  const [sourceDir, setSourceDir] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<GenerateOutput | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const unlisten = listen<Progress>('preview-progress', (e) => setProgress(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === 'string') setSourceDir(dir);
  }

  async function generate() {
    if (!sourceDir) return;
    setRunning(true);
    setResult(null);
    setProgress(null);
    try {
      const out = await invoke<GenerateOutput>('generate_previews', {
        sourceDir,
        outputDir: `${sourceDir}/.photobooth-previews`,
        maxEdge: 1600,
        jpegQuality: 80,
      });
      setResult(out);
    } finally {
      setRunning(false);
    }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="app">
      <h1>PhotoBooth Studio</h1>
      <p className="muted">
        Generate lightweight previews from your high-res originals. Originals never leave this
        machine — only previews get uploaded.
      </p>

      <div className="row">
        <button className="btn" onClick={pickFolder} disabled={running}>
          Choose originals folder
        </button>
        {sourceDir && <code>{sourceDir}</code>}
      </div>

      <div className="row">
        <button className="btn" onClick={generate} disabled={!sourceDir || running}>
          {running ? 'Generating…' : 'Generate previews'}
        </button>
      </div>

      {progress && (
        <div>
          <div className="bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            {progress.done}/{progress.total} — {progress.current}
          </p>
        </div>
      )}

      {result && (
        <div className="row" style={{ display: 'block' }}>
          <p>
            ✅ {result.photos.length} previews generated
            {result.failures.length > 0 && ` (${result.failures.length} failed)`}.
          </p>
          <p className="muted">Manifest: <code>{result.manifest_path}</code></p>
        </div>
      )}
    </div>
  );
}
