import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchGallery, submitSelection } from '../lib/api.js';

const PREVIEW_BASE = import.meta.env.VITE_R2_PUBLIC_BASE_URL ?? '';

export function GalleryPage() {
  const { shareToken = '' } = useParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['gallery', shareToken],
    queryFn: () => fetchGallery(shareToken),
  });

  const submit = useMutation({
    mutationFn: () =>
      submitSelection(
        shareToken,
        [...selected].map((photoUuid) => ({ projectId: '', photoUuid })),
      ),
  });

  function toggle(uuid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uuid) ? next.delete(uuid) : next.add(uuid);
      return next;
    });
  }

  if (isLoading) return <p style={{ padding: 24 }}>Loading gallery…</p>;
  if (error || !data) return <p style={{ padding: 24 }}>This gallery link is invalid or expired.</p>;

  return (
    <>
      <div className="bar">
        <strong>{data.projectName}</strong>
        <span>{selected.size} selected</span>
        <button
          className="btn"
          disabled={selected.size === 0 || submit.isPending || submit.isSuccess}
          onClick={() => submit.mutate()}
        >
          {submit.isSuccess ? 'Submitted ✓' : submit.isPending ? 'Submitting…' : 'Submit selection'}
        </button>
      </div>

      <div className="grid">
        {data.photos.map((p) => {
          const isSel = selected.has(p.uuid);
          return (
            <div
              key={p.uuid}
              className={`tile${isSel ? ' selected' : ''}`}
              onClick={() => toggle(p.uuid)}
            >
              <img src={`${PREVIEW_BASE}/${p.previewPath}`} alt={p.originalFilename} loading="lazy" />
              {isSel && <span className="check">✓</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}
