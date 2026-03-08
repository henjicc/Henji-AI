import { useCallback, useEffect, useMemo, useState } from 'react';

import { UiInput } from '@/components/ui';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { VisualToolEditorProps } from './types';
import { NumberStepper } from './splitStoryboard/NumberStepper';
import {
  clampDecimal,
  clampInteger,
  computeSplitLayout,
  DEFAULT_LINE_THICKNESS_PERCENT,
  formatPercent,
  LEGACY_DEFAULT_LINE_THICKNESS_PX,
  MAX_GRID_SIZE,
  MAX_LINE_THICKNESS_PERCENT,
  MIN_GRID_SIZE,
  PREVIEW_VIEWPORT_HEIGHT,
  resolveLineThicknessPxFromPercent,
  resolveMaxLineThicknessPx,
  splitSizeLabel,
  toFiniteNumber,
  toPercent,
  type SplitOptionsPatch,
} from './splitStoryboard/shared';

export function SplitStoryboardToolEditor({ sourceImageUrl, options, onOptionsChange }: VisualToolEditorProps): JSX.Element {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const displaySourceImageUrl = useMemo(() => resolveImageDisplayUrl(sourceImageUrl), [sourceImageUrl]);

  useEffect(() => {
    setNaturalSize(null);
  }, [displaySourceImageUrl]);

  const rows = clampInteger(toFiniteNumber(options.rows, 3), MIN_GRID_SIZE, MAX_GRID_SIZE);
  const cols = clampInteger(toFiniteNumber(options.cols, 3), MIN_GRID_SIZE, MAX_GRID_SIZE);

  const legacyLineThicknessPx = Math.max(0, toFiniteNumber(options.lineThickness, LEGACY_DEFAULT_LINE_THICKNESS_PX));
  const maxLineThicknessPercent = useMemo(() => {
    if (!naturalSize) {
      return MAX_LINE_THICKNESS_PERCENT;
    }

    const maxLinePx = resolveMaxLineThicknessPx(rows, cols, naturalSize.width, naturalSize.height);
    const basis = Math.max(1, Math.min(naturalSize.width, naturalSize.height));
    return clampDecimal((maxLinePx / basis) * 100, 0, MAX_LINE_THICKNESS_PERCENT);
  }, [cols, naturalSize, rows]);

  const fallbackLineThicknessPercent = useMemo(() => {
    if (!naturalSize) {
      return DEFAULT_LINE_THICKNESS_PERCENT;
    }

    const basis = Math.max(1, Math.min(naturalSize.width, naturalSize.height));
    return clampDecimal(
      (legacyLineThicknessPx / basis) * 100,
      0,
      maxLineThicknessPercent,
      DEFAULT_LINE_THICKNESS_PERCENT
    );
  }, [legacyLineThicknessPx, maxLineThicknessPercent, naturalSize]);

  const rawLineThicknessPercent = Math.max(
    0,
    toFiniteNumber(options.lineThicknessPercent, fallbackLineThicknessPercent)
  );
  const lineThicknessPercent = clampDecimal(
    rawLineThicknessPercent,
    0,
    maxLineThicknessPercent,
    fallbackLineThicknessPercent
  );

  const lineThicknessPx = useMemo(() => {
    if (!naturalSize) {
      return 0;
    }

    return resolveLineThicknessPxFromPercent(
      lineThicknessPercent,
      rows,
      cols,
      naturalSize.width,
      naturalSize.height
    );
  }, [cols, lineThicknessPercent, naturalSize, rows]);

  const layout = useMemo(() => {
    if (!naturalSize) {
      return null;
    }

    return computeSplitLayout(
      naturalSize.width,
      naturalSize.height,
      rows,
      cols,
      lineThicknessPx
    );
  }, [cols, lineThicknessPx, naturalSize, rows]);

  const updateOptions = useCallback(
    (patch: SplitOptionsPatch) => {
      const nextRows = clampInteger(
        patch.rows ?? rows,
        MIN_GRID_SIZE,
        MAX_GRID_SIZE
      );
      const nextCols = clampInteger(
        patch.cols ?? cols,
        MIN_GRID_SIZE,
        MAX_GRID_SIZE
      );

      const unresolvedLineThicknessPercent = Math.max(
        0,
        patch.lineThicknessPercent ?? lineThicknessPercent
      );

      const nextMaxLineThicknessPercent = naturalSize
        ? clampDecimal(
            (resolveMaxLineThicknessPx(nextRows, nextCols, naturalSize.width, naturalSize.height) /
              Math.max(1, Math.min(naturalSize.width, naturalSize.height))) *
              100,
            0,
            MAX_LINE_THICKNESS_PERCENT
          )
        : MAX_LINE_THICKNESS_PERCENT;

      const nextLineThicknessPercent = clampDecimal(
        unresolvedLineThicknessPercent,
        0,
        nextMaxLineThicknessPercent
      );

      onOptionsChange({
        ...options,
        rows: nextRows,
        cols: nextCols,
        lineThicknessPercent: nextLineThicknessPercent,
      });
    },
    [cols, lineThicknessPercent, naturalSize, onOptionsChange, options, rows]
  );

  const hasLayoutError = Boolean(naturalSize && !layout);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>原图 + 切割预览</span>
          {naturalSize && (
            <span>
              {naturalSize.width} x {naturalSize.height}px
            </span>
          )}
        </div>

        <div
          className={`ui-scrollbar flex ${PREVIEW_VIEWPORT_HEIGHT} items-center justify-center overflow-auto rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/70 p-3`}
        >
          <div className="relative inline-flex items-center justify-center">
            <img
              src={displaySourceImageUrl}
              alt="split-preview"
              className="max-h-full w-auto max-w-full rounded-lg border border-[rgba(255,255,255,0.08)] object-contain"
              onLoad={(event) => {
                const target = event.currentTarget;
                setNaturalSize({
                  width: Math.max(1, target.naturalWidth),
                  height: Math.max(1, target.naturalHeight),
                });
              }}
            />

            {naturalSize && layout && (
              <div className="pointer-events-none absolute inset-0 rounded-lg">
                {layout.lineRects.map((rect, index) => (
                  <div
                    key={`line-${index}`}
                    className="absolute bg-red-400/35"
                    style={{
                      left: toPercent(rect.x, naturalSize.width),
                      top: toPercent(rect.y, naturalSize.height),
                      width: toPercent(rect.width, naturalSize.width),
                      height: toPercent(rect.height, naturalSize.height),
                    }}
                  />
                ))}

                {layout.cellRects.map((cell, index) => (
                  <div
                    key={`cell-${index}`}
                    className="absolute border border-white/40"
                    style={{
                      left: toPercent(cell.x, naturalSize.width),
                      top: toPercent(cell.y, naturalSize.height),
                      width: toPercent(cell.width, naturalSize.width),
                      height: toPercent(cell.height, naturalSize.height),
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-text-muted">
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-400/70" />
            红色区域为切割时会丢弃的分割线像素
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/75 p-3.5">
        <div className="text-sm font-medium text-text-dark">切割参数</div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <NumberStepper
            label="行数"
            value={rows}
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            onChange={(value) => updateOptions({ rows: value })}
          />
          <NumberStepper
            label="列数"
            value={cols}
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            onChange={(value) => updateOptions({ cols: value })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>分割线粗细</span>
            <span>
              {formatPercent(lineThicknessPercent)}
              {naturalSize ? ` (${lineThicknessPx}px)` : ''}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, maxLineThicknessPercent)}
            step={0.1}
            value={lineThicknessPercent}
            onChange={(event) => updateOptions({ lineThicknessPercent: Number(event.target.value) })}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15"
          />
          <UiInput
            type="number"
            value={lineThicknessPercent}
            min={0}
            max={Math.max(0, maxLineThicknessPercent)}
            step={0.1}
            onChange={(event) => updateOptions({ lineThicknessPercent: Number(event.target.value) })}
            className="h-9"
          />
        </div>

        <div className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-bg-dark/80 px-3 py-2 text-xs text-text-muted">
          <div className="flex items-center justify-between">
            <span>输出小格数量</span>
            <span className="font-medium text-text-dark">{rows * cols}</span>
          </div>
          {layout && (
            <>
              <div className="mt-1 flex items-center justify-between">
                <span>单格宽度(px)</span>
                <span>{splitSizeLabel(layout.minCellWidth, layout.maxCellWidth)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>单格高度(px)</span>
                <span>{splitSizeLabel(layout.minCellHeight, layout.maxCellHeight)}</span>
              </div>
            </>
          )}
        </div>

        {hasLayoutError && (
          <div className="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            当前分割线过粗，导致可切割区域不足。请减少线宽或降低行列数。
          </div>
        )}
      </div>
    </div>
  );
}
