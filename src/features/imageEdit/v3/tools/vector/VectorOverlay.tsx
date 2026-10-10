import { useEffect, useRef, useState } from 'react';
import { UiButton, UiError, UiPanel, UiTextArea } from '@/components/ui';
import type { MarkItem } from '@/core/imageEdit/types';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';
import { imageEditLayersFromMarkDraftV3 } from '@/core/imageEdit/v3/layerEntries/vectorDraft';
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory';
import { useImageEditorSessionStoreV3 } from '../../store';
import { mapAnnotationPointV3, invertAnnotationMatrixV3 } from '../../editor/annotationGeometryV3';
import type { ToolOverlayContext } from '../../toolFramework/types';
import { addImageEditVectorLayersV3 } from './service';

export function VectorOverlay({ controller, geometry, bindKeyboard }: ToolOverlayContext): JSX.Element | null {
  const session = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]);
  const setSelected = useImageEditorSessionStoreV3(state => state.setSelectedLayerIds);
  const host = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ point: readonly [number, number]; item: MarkItem; revision: number; pointerId: number } | null>(null);
  const [draft, setDraft] = useState<MarkItem | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const composing = useRef(false);
  const tool = session?.activeTool ?? 'move';
  const clear = (): void => { gesture.current = null; setDraft(null); setText(''); setError(''); };
  useEffect(() => { clear(); }, [controller.document.id, controller.document.revision, tool]);
  useEffect(() => bindKeyboard('vector', event => { if (event.key !== 'Escape') return false; clear(); return true; }), [bindKeyboard]);
  const commit = (item: MarkItem): void => {
    try {
      const layers = imageEditLayersFromMarkDraftV3(item, controller.document.layers.filter(layer => layer.type === 'text').length + 1);
      addImageEditVectorLayersV3(controller.document.id, layers);
      setSelected(controller.sessionId, layers.map(layer => layer.id)); clear();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法添加内容，请重试。'); }
  };
  const point = (clientX: number, clientY: number): readonly [number, number] => {
    const rect = host.current!.getBoundingClientRect();
    return mapAnnotationPointV3(invertAnnotationMatrixV3(geometry.sourceToOutput), [(clientX - rect.left) * geometry.width / rect.width, (clientY - rect.top) * geometry.height / rect.height]);
  };
  const update = (item: MarkItem, start: readonly [number, number], end: readonly [number, number], constrained: boolean): MarkItem => {
    if (item.type === 'arrow') return { ...item, points: [start[0], start[1], end[0], end[1]] };
    if (item.type === 'pen') return { ...item, points: [...item.points, end[0], end[1]] };
    if (item.type === 'rect' || item.type === 'ellipse') {
      const dx = end[0] - start[0], dy = end[1] - start[1], size = Math.max(Math.abs(dx), Math.abs(dy));
      const x = constrained ? start[0] + Math.sign(dx || 1) * size : end[0], y = constrained ? start[1] + Math.sign(dy || 1) * size : end[1];
      return { ...item, x: Math.min(start[0], x), y: Math.min(start[1], y), width: Math.abs(x - start[0]), height: Math.abs(y - start[1]) };
    }
    return item;
  };
  if (!tool.startsWith('vector-')) return null;
  const settings = session?.toolSettings;
  const base = Math.min(controller.document.geometry.width, controller.document.geometry.height);
  const fontSize = Math.max(1, base * (settings?.annotationTextSizePercent ?? 5) / 100);
  const color = settings?.annotationColor ?? ANNOTATION_DEFAULT_STROKE_HEX;
  const lineWidth = Math.max(.1, base * (settings?.annotationLineWidthPercent ?? .6) / 100);
  return <div ref={host} data-vector-overlay data-image-editor-tool-slot="vector" className="absolute inset-0"
    onPointerDown={event => {
      if (event.button !== 0 || draft?.type === 'text' || event.target !== event.currentTarget) return;
      const at = point(event.clientX, event.clientY), id = createImageEditIdV3('content');
      const item: MarkItem = tool === 'vector-text' ? { id, type: 'text', x: at[0], y: at[1], fontSize, color, text: '' }
        : tool === 'vector-number' ? { id, type: 'number', x: at[0], y: at[1], fontSize, color }
        : tool === 'vector-arrow' ? { id, type: 'arrow', points: [at[0], at[1], at[0], at[1]], stroke: color, lineWidth }
        : tool === 'vector-path' ? { id, type: 'pen', points: [at[0], at[1]], stroke: color, lineWidth }
        : { id, type: tool === 'vector-ellipse' ? 'ellipse' : 'rect', x: at[0], y: at[1], width: 0, height: 0, stroke: color, lineWidth, ...(tool === 'vector-callout' ? { label: '说明', labelFontSize: fontSize } : {}) };
      if (item.type === 'number') { commit(item); return; }
      setDraft(item);
      if (item.type === 'text') return;
      gesture.current = { point: at, item, revision: controller.document.revision, pointerId: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return; current.item = update(current.item, current.point, point(event.clientX, event.clientY), event.shiftKey); setDraft(current.item); }}
    onPointerUp={event => {
      const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
      const final = update(current.item, current.point, point(event.clientX, event.clientY), event.shiftKey);
      gesture.current = null;
      if (current.revision === controller.document.revision && Math.hypot(...point(event.clientX, event.clientY).map((value, index) => value - current.point[index])) >= 1) commit(final); else clear();
    }} onPointerCancel={clear} onLostPointerCapture={() => { if (gesture.current) clear(); }}>
    {/* icon-token-allow: 手势正在绘制的矢量内容预览，不是界面图标。 */}
    {draft && draft.type !== 'text' ? <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none"><g transform={`matrix(${geometry.sourceToOutput.join(' ')})`} fill="none" stroke={'stroke' in draft ? draft.stroke : color} strokeWidth={lineWidth}>
      {draft.type === 'rect' ? <rect x={draft.x} y={draft.y} width={draft.width} height={draft.height} /> : draft.type === 'ellipse' ? <ellipse cx={draft.x + draft.width / 2} cy={draft.y + draft.height / 2} rx={draft.width / 2} ry={draft.height / 2} /> : draft.type === 'arrow' || draft.type === 'pen' ? <polyline points={draft.points.join(' ')} /> : null}
    </g></svg> : null}
    {draft?.type === 'text' ? <div className="absolute inset-0 flex items-center justify-center" onPointerDown={event => event.stopPropagation()}><UiPanel variant="glass" className="flex w-80 flex-col gap-3 p-4">
      <UiTextArea aria-label="文字内容" autoFocus value={text} rows={3} onChange={event => setText(event.currentTarget.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (composing.current || event.nativeEvent.isComposing) return; if (event.key === 'Escape') { event.stopPropagation(); clear(); } if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); if (text) commit({ ...draft, text }); } }} />
      <div className="flex justify-end gap-2"><UiButton size="sm" onClick={clear}>取消</UiButton><UiButton size="sm" variant="primary" disabled={!text} onClick={() => { if (!composing.current) commit({ ...draft, text }); }}>添加文字</UiButton></div>
    </UiPanel></div> : null}
    {error ? <UiError message={error} /> : null}
  </div>;
}
