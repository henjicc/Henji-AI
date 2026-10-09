import { evaluateRegionProgram, type RegionProgram, type RegionRect, type RegionGrid } from '@/core/imaging/regions';
import { PaintDabGenerator, rasterizePaintDabs, type PaintBrush, type PaintDab } from '@/core/imaging/paint';
import { isMaskStroke, resolveMaskShapeBounds } from './maskDocument';
import type { MaskEditorDocument } from './types';

type QuickMaskOperation = { kind: 'brush'; dabs: PaintDab[]; brush: PaintBrush; erase: boolean }
  | { kind: 'region'; program: RegionProgram; erase: boolean };
export interface QuickMaskPaintProgram { grid: RegionGrid; operations: QuickMaskOperation[] }

/** Parameter marks retain their document/confirmation contract; all brush coverage uses I/paint. */
export function quickMaskRegionProgram(document: MaskEditorDocument): QuickMaskPaintProgram {
  const operations: QuickMaskOperation[] = [];
  for (const mark of document.strokes) {
    if (!mark.points.length) continue;
    const erase = mark.mode === 'erase';
    if (isMaskStroke(mark)) {
      const brush: PaintBrush = { size: mark.size, hardness: mark.hardness ?? 1, opacity: 1, flow: 1, pressureSize: false };
      const generator = new PaintDabGenerator(brush);
      const dabs = generator.append(mark.points); dabs.push(...generator.finish());
      operations.push({ kind: 'brush', dabs, brush, erase });
    } else {
      const points = mark.points.map(p => ({ x: p.x / document.width, y: p.y / document.height }));
      const bounds = mark.kind === 'lasso' ? null : resolveMaskShapeBounds(mark.kind, mark.points[0], mark.points[1]);
      const shape = mark.kind === 'lasso' ? { type: 'lasso' as const, points }
        : { type: mark.kind === 'circle' ? 'ellipse' as const : 'rectangle' as const,
          x: bounds!.x / document.width, y: bounds!.y / document.height, width: bounds!.width / document.width, height: bounds!.height / document.height };
      operations.push({ kind: 'region', erase, program: { operations: [{ shape, combine: 'replace' }], feather: 0, inverted: false } });
    }
  }
  return { grid: { width: document.width, height: document.height }, operations };
}

export function evaluateQuickMaskProgram(program: QuickMaskPaintProgram, region: RegionRect, grid: RegionGrid = program.grid): Float32Array {
  const data = new Float32Array(region.width * region.height);
  for (const operation of program.operations) {
    if (operation.kind === 'brush') {
      const sx = grid.width / program.grid.width, sy = grid.height / program.grid.height;
      const dabs = operation.dabs.map(d => ({ ...d, x: d.x * sx, y: d.y * sy, radius: d.radius * sx, roundness: d.roundness * sy / sx }));
      rasterizePaintDabs({ width: region.width, height: region.height, originX: region.x, originY: region.y,
        before: new Float32Array(data), output: data, coverage: new Float32Array(data.length) }, dabs, operation.brush,
        { kind: 'mask', value: 1 }, operation.erase ? 'eraser' : 'brush');
    } else {
      const coverage = evaluateRegionProgram(operation.program, grid, region);
      for (let i = 0; i < data.length; i++) data[i] = operation.erase ? data[i] * (1 - coverage[i]) : data[i] + (1 - data[i]) * coverage[i];
    }
  }
  return data;
}

export function rasterizeQuickMaskCoverage(document: MaskEditorDocument, region: RegionRect, grid: RegionGrid = document): Float32Array {
  return evaluateQuickMaskProgram(quickMaskRegionProgram(document), region, grid);
}
