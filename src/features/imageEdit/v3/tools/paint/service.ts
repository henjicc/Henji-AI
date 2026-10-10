import type { ImageEditPaintIntentV3 } from '@/core/imageEdit/v3/brush/intent';
import type { PaintFill } from '@/core/imaging/paint';
import type { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { ImageEditorRasterBrushStrokeV3 } from '../../editor/rasterBrushStrokeV3';
import { resolveImageEditorBrushEditingTargetV3 } from '../../editor/brushEditingTargetV3';
import { fillImageEditTargetV3 } from './fillService';
import { createPaintSelectionClip } from './selectionClip';
import { PaintWorkerClient } from './workerClient';
import { paintColorInDocument } from './color';
import { RetouchStrokeCompute } from '../retouch/source';

/** Algorithm adapter, also available to non-visual callers; no UI focus or preset dependency. */
export async function paintImageEditTargetV3(bus: ImageEditCommandBusV3, layerId: string, destination: 'pixels' | 'mask', operation: ImageEditPaintIntentV3, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  const retouching = operation.kind === 'clone' || operation.kind === 'heal';
  if (retouching && destination !== 'pixels') throw new Error('仿制图章与修复画笔的 destination 必须是 pixels');
  const start = bus.getSnapshot(), resourceByteSizes = new Map(Object.entries(bus.getResourceByteSizes()));
  const resolved = resolveImageEditorBrushEditingTargetV3({ document: start.document, selectedLayerIds: [layerId], activeTool: destination === 'mask' ? 'mask-edit' : 'raster-brush',
    maskMode: operation.kind === 'stroke' && operation.tool === 'eraser' ? 'erase' : 'paint', color: 'color' in operation ? operation.color : undefined,
    maskValue: 'maskValue' in operation ? operation.maskValue : 1, resourceByteSizes });
  if (!resolved.ready) throw new Error(`绘画目标不可用：${resolved.reason}；请读取目标图层与蒙版状态`);
  const target = resolved.target, size = target.resolveStorageSize ?? (async () => start.document.geometry);
  const grid = await size(signal ?? new AbortController().signal); signal?.throwIfAborted();
  if (bus.getSnapshot().document.revision !== start.document.revision || bus.getSnapshot().selectionRevision !== start.selectionRevision) throw new Error('绘画目标已变化，请重新读取');
  if ('points' in operation) {
    if (operation.kind === 'stroke' && destination === 'pixels' && operation.tool === 'brush' && !operation.color) throw new Error('像素画笔需要 color');
    const clip = createPaintSelectionClip(start.document, start.selection, target.matrix, size);
    const worker = operation.kind === 'stroke' ? new PaintWorkerClient() : new RetouchStrokeCompute(target.loadTile, size, operation.kind,
      { x: (operation.source.x - operation.points[0].x) * grid.width, y: (operation.source.y - operation.points[0].y) * grid.height }, clip.read);
    const dynamics = operation.kind === 'stroke' ? { smoothing: operation.smoothing, pressureSize: operation.pressureSize, pressureFlow: operation.pressureFlow, pressureCurve: operation.pressureCurve, tip: operation.tip, angle: operation.angle, tilt: operation.tilt, texture: operation.texture, scatter: operation.scatter } : {};
    const stroke = new ImageEditorRasterBrushStrokeV3({ bus, document: start.document, layerId, destination: target.destination, tool: operation.kind === 'stroke' ? operation.tool : 'brush',
      shape: { size: operation.sizeRatio * Math.min(grid.width, grid.height), hardness: operation.hardness, opacity: operation.opacity, flow: operation.flow, spacing: operation.spacing, seed: operation.seed, ...dynamics }, target: target.target, loadTile: target.loadTile,
      resolveStorageSize: size, resourceByteSizes, onPreviewTiles: () => {}, rasterize: worker.rasterize, loadCoverage: clip.read });
    const cancel = (): void => { stroke.cancel(); worker.dispose(); clip.dispose(); };
    const unsubscribe = bus.subscribe(() => { if (bus.getSnapshot().selectionRevision !== start.selectionRevision) cancel(); });
    signal?.addEventListener('abort', cancel, { once: true }); bus.getLifecycleSignal().addEventListener('abort', cancel, { once: true });
    try {
      stroke.begin();
      // Bound the input queue, preserving sample order and the same incremental generator.
      for (let offset = 0; offset < operation.points.length; offset += 128) {
        signal?.throwIfAborted();
        await stroke.append(operation.points.slice(offset, offset + 128).map(point => ({ ...point, x: point.x * grid.width, y: point.y * grid.height,
          screenX: point.x * grid.width, screenY: point.y * grid.height })));
      }
      const result = await stroke.finish();
      signal?.throwIfAborted(); bus.getLifecycleSignal().throwIfAborted();
      if (bus.getSnapshot().selectionRevision !== start.selectionRevision) throw new Error('选区已变化，请重新绘画');
      return result ? (await bus.readHistoryHead())?.commandId ?? null : null;
    } finally { unsubscribe(); cancel(); signal?.removeEventListener('abort', cancel); bus.getLifecycleSignal().removeEventListener('abort', cancel); }
  }
  let fill: PaintFill;
  if (operation.kind === 'solid') {
    if (destination === 'pixels' && !operation.color) throw new Error('像素填充需要 color');
    fill = { kind: 'solid', target: destination === 'mask' ? { kind: 'mask', value: operation.maskValue }
      : { kind: 'rgba', color: paintColorInDocument(start.document, operation.color!) } };
  } else {
    fill = { kind: operation.kind, start: { x: operation.start.x * grid.width, y: operation.start.y * grid.height }, end: { x: operation.end.x * grid.width, y: operation.end.y * grid.height },
      stops: operation.stops.map(stop => {
        if (destination === 'pixels' && !stop.color) throw new Error('像素渐变的每个色标需要 color');
        return { position: stop.position, color: destination === 'mask' ? [stop.maskValue, stop.maskValue, stop.maskValue, 1] as const
          : paintColorInDocument(start.document, stop.color!, stop.alpha) };
      }) };
  }
  return fillImageEditTargetV3(bus, layerId, destination, fill, operation.opacity, { target, signal });
}
