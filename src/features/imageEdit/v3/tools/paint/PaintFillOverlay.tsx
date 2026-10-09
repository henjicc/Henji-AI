import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiError, UiLoading, UiPanel } from '@/components/ui';
import type { PaintFill } from '@/core/imaging/paint';
import { useImageEditorSessionStoreV3 } from '../../store';
import { mapAnnotationPointV3 } from '../../editor/annotationGeometryV3';
import { captureEditorPointerV3, releaseEditorPointerV3, type CapturedEditorPointerV3 } from '../../editor/pointerCaptureV3';
import { resolveImageEditorBrushEditingTargetV3, type ImageEditorBrushEditingTargetV3 } from '../../editor/brushEditingTargetV3';
import type { ToolOverlayContext } from '../../toolFramework/types';
import { fillImageEditTargetV3 } from './fillService';
import { paintColorInDocument } from './color';

type Point = { x: number; y: number };
interface FillGesture { start: Point; target: ImageEditorBrushEditingTargetV3; pointer: CapturedEditorPointerV3; revision: number; selectionRevision: number }

export function PaintFillOverlayV3({ controller, bus, geometry, bindKeyboard, bindPointerAvailability }: ToolOverlayContext): JSX.Element | null {
  const { t } = useTranslation('ui');
  const session = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]);
  const svg = useRef<SVGSVGElement>(null), gesture = useRef<FillGesture | null>(null), task = useRef<AbortController | null>(null);
  const [line, setLine] = useState<{ start: Point; end: Point } | null>(null), [error, setError] = useState<string | null>(null), [progress, setProgress] = useState<number | null>(null);
  const selectedKey = session?.selectedLayerIds.join('\u0000');
  const active = session?.activeTool === 'paint-gradient' || session?.activeTool === 'paint-fill';
  const cancel = useCallback((): void => { if (gesture.current) releaseEditorPointerV3(gesture.current.pointer); gesture.current = null; task.current?.abort(); task.current = null; setLine(null); setProgress(null); }, []);
  useEffect(() => {
    const keyboard = bindKeyboard('paint-fill', event => { if (event.code !== 'Escape' || (!gesture.current && !task.current)) return false; cancel(); return true; });
    const pointer = bindPointerAvailability('paint-fill', () => !task.current);
    return () => { keyboard(); pointer(); if (gesture.current) releaseEditorPointerV3(gesture.current.pointer); gesture.current = null; task.current?.abort(); task.current = null; };
  }, [bindKeyboard, bindPointerAvailability, cancel]);
  useEffect(() => { cancel(); setError(null); }, [cancel, session?.activeTool, session?.editTarget, selectedKey]);
  if (!active || !session) return null;
  const label = (key: string): string => t(`imageEditor.v3.paint.${key}`);
  const local = (event: ReactPointerEvent<SVGSVGElement>): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * geometry.width / rect.width, y: (event.clientY - rect.top) * geometry.height / rect.height };
  };
  const apply = async (current: FillGesture, end: Point): Promise<void> => {
    if (bus.getSnapshot().document.revision !== current.revision || bus.getSnapshot().selectionRevision !== current.selectionRevision) { setError(label('targetChanged')); setLine(null); return; }
    const abort = new AbortController(); task.current = abort; setProgress(0); setError(null);
    const settings = session.toolSettings, document = bus.getSnapshot().document;
    const mask = current.target.target.kind === 'mask';
    const startXY = mapAnnotationPointV3(current.target.inverseMatrix, [current.start.x, current.start.y]);
    const endXY = mapAnnotationPointV3(current.target.inverseMatrix, [end.x, end.y]);
    const startColor: readonly [number, number, number, number] = mask ? [settings.paintMaskValue, settings.paintMaskValue, settings.paintMaskValue, 1] : paintColorInDocument(document, settings.paintColor);
    const endColor: readonly [number, number, number, number] = mask ? [settings.paintMaskEnd, settings.paintMaskEnd, settings.paintMaskEnd, 1] : paintColorInDocument(document, settings.paintEndColor);
    const fill: PaintFill = session.activeTool === 'paint-fill' ? { kind: 'solid', target: mask ? { kind: 'mask', value: settings.paintMaskValue } : { kind: 'rgba', color: startColor } }
      : { kind: settings.paintGradientKind, start: { x: startXY[0], y: startXY[1] }, end: { x: endXY[0], y: endXY[1] }, stops: [{ position: 0, color: startColor }, { position: 1, color: endColor }] };
    try { await fillImageEditTargetV3(bus, current.target.layerId, mask ? 'mask' : 'pixels', fill, settings.brushOpacity,
      { target: current.target, signal: abort.signal, onProgress: (done, total) => { if (task.current === abort) setProgress(done / total); } }); }
    catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (task.current === abort) { task.current = null; setProgress(null); setLine(null); } }
  };
  const down = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 || task.current || gesture.current) return;
    const document = bus.getSnapshot().document;
    const resolved = resolveImageEditorBrushEditingTargetV3({ document, selectedLayerIds: session.selectedLayerIds,
      activeTool: session.editTarget === 'mask' ? 'mask-edit' : 'raster-brush', maskMode: 'paint', resourceByteSizes: new Map(Object.entries(bus.getResourceByteSizes())) });
    if (!resolved.ready) { setError(t(`imageEditor.v3.rasterBrush.${resolved.reason}`)); return; }
    const start = local(event); setError(null);
    const current = { start, target: resolved.target, revision: document.revision, selectionRevision: bus.getSnapshot().selectionRevision, pointer: captureEditorPointerV3(event.currentTarget, event.pointerId) };
    gesture.current = current; setLine({ start, end: start }); event.preventDefault();
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!gesture.current || gesture.current.pointer.pointerId !== event.pointerId) return;
    setLine({ start: gesture.current.start, end: local(event) });
  };
  const up = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gesture.current;
    if (!current || current.pointer.pointerId !== event.pointerId) return;
    const end = local(event); gesture.current = null; releaseEditorPointerV3(current.pointer); void apply(current, end);
  };
  return <>
    {/* icon-token-allow: 渐变起终点在作品像素空间中展示，属于可编辑几何而非图标。 */}
    <svg ref={svg} data-paint-fill-overlay aria-label={label(session.activeTool === 'paint-fill' ? 'fillArea' : 'gradientArea')}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full touch-none"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }}>
      {line && session.activeTool === 'paint-gradient' && <g pointerEvents="none" className="text-on-media" stroke="currentColor" fill="none">
        <line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} vectorEffect="non-scaling-stroke" />
        <circle cx={line.start.x} cy={line.start.y} r={geometry.width / 100} vectorEffect="non-scaling-stroke" />
        <circle cx={line.end.x} cy={line.end.y} r={geometry.width / 100} vectorEffect="non-scaling-stroke" />
      </g>}
    </svg>
    {(progress !== null || error) && <UiPanel className="absolute left-1/2 top-3 max-w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 px-4">
      {progress !== null && <UiLoading size="sm" message={`${label('working')} ${Math.round(progress * 100)}%`}><UiButton size="sm" onClick={cancel}>{label('cancel')}</UiButton></UiLoading>}
      {error && <UiError size="sm" message={error} />}
    </UiPanel>}
  </>;
}
