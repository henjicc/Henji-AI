import React, { useEffect, useRef, useState } from 'react';
import { useRafCallback } from '@/hooks/useRafCallback';
import type { DocumentCoverSource } from '@/core/documents/types';
import { FILMSTRIP_GRID_US, filmstripHeightBucket } from '@/core/media/filmstripFrames';
import { useFilmstripFramesRevision } from '@/hooks/useFilmstripFrames';
import { loadImageElement, resolveImageDisplayUrl } from '@/services/imageSource';
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
  const [imageReady, setImageReady] = useState<string | null>(null);
  const loading = useRef(false);
  const generation = useRef(0);
  // 新位置的缩略帧还没解出来时沿用上一幅，避免拖动中闪回封面
  const shown = useRef<string | null>(null);
  const release = useRef<(() => void) | null>(null);
  useFilmstripFramesRevision();
  const height = filmstripHeightBucket(180 * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));

  useEffect(() => () => { generation.current++; release.current?.(); release.current = null; }, []);
  const move = useRafCallback((next: number) => setFraction(next));

  const enter = (): void => {
    if (preview || loading.current) return;
    loading.current = true;
    const current = ++generation.current;
    void load().then((previewer) => {
      if (current !== generation.current) return;
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
  const selected = preview && fraction !== null ? preview(fraction) : null;
  // 原视频仍共用预取的 16 档；合成图片按自身位置查找，不丢掉较密档位。
  const source = selected?.sourceKind === 'video' && preview && fraction !== null ? preview((Math.min(STEPS - 1, Math.floor(fraction * STEPS)) + 0.5) / STEPS) : selected;
  const image = source?.sourceKind === 'image' ? source.source : null;
  useEffect(() => {
    if (!image) return;
    let current = true;
    void loadImageElement(image).then(() => { if (current) setImageReady(image); }, () => {});
    return () => { current = false; };
  }, [image]);
  const ready = source?.sourceKind === 'video' ? nearestFilmstripFrame(frameRef(source, height)) : imageReady === image ? image : null;
  if (fraction === null) shown.current = null;
  else if (ready) shown.current = ready;
  const frame = fraction === null ? null : shown.current;

  return (
    <span
      className="absolute inset-0 block"
      onPointerEnter={enter}
      onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); if (rect.width > 0) move.schedule(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))); }}
      onPointerLeave={() => { move.cancel(); generation.current++; loading.current = false; setFraction(null); setPreview(null); setImageReady(null); release.current?.(); release.current = null; }}
    >
      {children}
      {frame ? <img src={resolveImageDisplayUrl(frame)} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 h-full w-full object-cover" /> : null}
      {fraction !== null && preview ? <span aria-hidden="true" className="absolute bottom-0 h-0.5 bg-accent-ring" style={{ left: 0, width: `${fraction * 100}%` }} /> : null}
    </span>
  );
}
