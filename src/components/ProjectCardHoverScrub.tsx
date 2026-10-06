import React, { useEffect, useRef, useState } from 'react';
import type { DocumentCoverSource } from '@/core/documents/types';
import { FILMSTRIP_GRID_US, filmstripHeightBucket } from '@/core/media/filmstripFrames';
import { useFilmstripFramesRevision } from '@/hooks/useFilmstripFrames';
import { resolveImageDisplayUrl } from '@/services/imageSource';
import { acquireFilmstripFrames, nearestFilmstripFrame, type FilmstripFrameRef } from '@/services/videoFilmstrip/filmstripFrameService';

/** 位置 → 画面来源（悬停预览取法）；第一次悬停时才加载。 */
export type ProjectCardHoverPreviewLoader = () => Promise<((fraction: number) => DocumentCoverSource | null) | null>;

/** 悬停时预先取的画面数：左右移动时在这些位置之间切换，取帧走缩略帧缓存。 */
const STEPS = 16;

function frameRef(source: DocumentCoverSource, height: FilmstripFrameRef['height']): FilmstripFrameRef {
  // 取帧时间落在缩略帧网格上（与片段缩略图条共用缓存）
  return { source: source.source, timeUs: Math.round((source.atSeconds ?? 0) * 1e6 / FILMSTRIP_GRID_US) * FILMSTRIP_GRID_US, height };
}

/**
 * 项目卡片封面的悬停预览（Premiere 素材的悬停擦洗）：鼠标在封面上左右移动，显示片子里对应位置的画面，
 * 底部一条细线标出位置；移开恢复封面。不支持的类型（没有登记取法）不挂这一层。
 */
export function ProjectCardHoverScrub({ load, children }: { load: ProjectCardHoverPreviewLoader; children: React.ReactNode }): React.ReactElement {
  const [preview, setPreview] = useState<((fraction: number) => DocumentCoverSource | null) | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const loading = useRef(false);
  const release = useRef<(() => void) | null>(null);
  useFilmstripFramesRevision();
  const height = filmstripHeightBucket(180 * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));

  useEffect(() => () => { release.current?.(); release.current = null; }, []);

  const enter = (): void => {
    if (preview || loading.current) return;
    loading.current = true;
    void load().then((previewer) => {
      loading.current = false;
      if (!previewer) return;
      setPreview(() => previewer);
      // 先把各个位置的画面要过来，左右移动时直接显示
      const refs = Array.from({ length: STEPS }, (_, index) => previewer((index + 0.5) / STEPS))
        .filter((source): source is DocumentCoverSource => source?.sourceKind === 'video')
        .map((source) => frameRef(source, height));
      release.current?.();
      release.current = refs.length ? acquireFilmstripFrames(refs) : null;
    });
  };
  const step = fraction === null ? null : Math.min(STEPS - 1, Math.floor(fraction * STEPS));
  const source = preview && step !== null ? preview((step + 0.5) / STEPS) : null;
  const frame = source?.sourceKind === 'video' ? nearestFilmstripFrame(frameRef(source, height)) : source?.source;

  return (
    <span
      className="absolute inset-0 block"
      onPointerEnter={enter}
      onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); if (rect.width > 0) setFraction(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))); }}
      onPointerLeave={() => setFraction(null)}
    >
      {children}
      {frame ? <img src={resolveImageDisplayUrl(frame)} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 h-full w-full object-cover" /> : null}
      {fraction !== null && preview ? <span aria-hidden="true" className="absolute bottom-0 h-0.5 bg-accent-ring" style={{ left: 0, width: `${fraction * 100}%` }} /> : null}
    </span>
  );
}
