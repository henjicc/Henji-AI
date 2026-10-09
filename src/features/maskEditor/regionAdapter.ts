import { evaluateRegionProgram, type RegionOperation, type RegionProgram, type RegionRect, type RegionGrid } from '@/core/imaging/regions';
import { tracePenPath } from '@/core/imageEdit/marks/tracePenPath';
import { createMaskBrushRenderLayers } from './brushHardness';
import { isMaskStroke, resolveMaskShapeBounds } from './maskDocument';
import type { MaskEditorDocument, MaskPoint } from './types';

/** Flatten the existing shared tension path; this adapter does not define another brush/dab engine. */
function regionPath(points: MaskPoint[]): MaskPoint[] {
  const output: MaskPoint[] = [];
  const add = (x: number, y: number): void => { output.push({ x, y }); };
  const curve = (controls: MaskPoint[]): void => {
    // De Casteljau subdivision until the control polygon is within a quarter source pixel of a line.
    const [start] = controls, end = controls[controls.length - 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const flat = controls.slice(1, -1).every(p => length === 0
      ? Math.hypot(p.x - start.x, p.y - start.y) <= 0.25
      : Math.abs((end.x - start.x) * (start.y - p.y) - (start.x - p.x) * (end.y - start.y)) / length <= 0.25
        && (p.x - start.x) * (end.x - start.x) + (p.y - start.y) * (end.y - start.y) >= 0
        && (p.x - end.x) * (start.x - end.x) + (p.y - end.y) * (start.y - end.y) >= 0);
    if (flat) { add(end.x, end.y); return; }
    const left = [start], right = [end];
    let row = controls;
    while (row.length > 1) {
      row = row.slice(1).map((p, i) => ({ x: (p.x + row[i].x) / 2, y: (p.y + row[i].y) / 2 }));
      left.push(row[0]); right.unshift(row[row.length - 1]);
    }
    curve(left); curve(right);
  };
  tracePenPath({
    beginPath: () => {}, moveTo: add, lineTo: add,
    quadraticCurveTo: (cx, cy, x, y) => curve([output[output.length - 1], { x: cx, y: cy }, { x, y }]),
    bezierCurveTo: (ax, ay, bx, by, x, y) => curve([output[output.length - 1], { x: ax, y: ay }, { x: bx, y: by }, { x, y }]),
  }, points.flatMap(p => [p.x, p.y]));
  return output;
}

/** Retains parameter paint/erase semantics while sharing Float32 coverage with selection and layer masks. */
export function quickMaskRegionProgram(document: MaskEditorDocument): RegionProgram {
  const operations: RegionOperation[] = [];
  const normalize = (points: MaskPoint[]): MaskPoint[] => points.map(p => ({ x: p.x / document.width, y: p.y / document.height }));
  for (const mark of document.strokes) {
    if (mark.points.length === 0) continue;
    const combine = mark.mode === 'paint' ? 'paint' : 'erase';
    if (isMaskStroke(mark)) {
      const points = normalize(regionPath(mark.points));
      for (const layer of createMaskBrushRenderLayers(mark.size, mark.hardness)) {
        operations.push({ shape: { type: 'brush', points, radius: layer.size / (2 * Math.min(document.width, document.height)) }, combine, opacity: layer.opacity });
      }
    } else if (mark.kind === 'lasso') {
      operations.push({ shape: { type: 'lasso', points: normalize(mark.points) }, combine });
    } else {
      const bounds = resolveMaskShapeBounds(mark.kind, mark.points[0], mark.points[1]);
      operations.push({ shape: { type: mark.kind === 'circle' ? 'ellipse' : 'rectangle',
        x: bounds.x / document.width, y: bounds.y / document.height,
        width: bounds.width / document.width, height: bounds.height / document.height }, combine });
    }
  }
  return { operations, feather: 0, inverted: false };
}

export function rasterizeQuickMaskCoverage(document: MaskEditorDocument, region: RegionRect, grid: RegionGrid = document): Float32Array {
  return evaluateRegionProgram(quickMaskRegionProgram(document), grid, region);
}
