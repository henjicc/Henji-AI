import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  UI_TEXT_META_CLASS,
  UI_TEXT_NUMERIC_CLASS,
  UiError,
  UiFormRow,
  UiGroup,
  UiPanel,
  UiRangeInput,
} from '@/components/ui';
import NumberField from '@/components/ui/NumberInput';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { VisualToolEditorProps } from './types';
import {
  clampDecimal,
  clampInteger,
  computeSplitLayout,
  DEFAULT_LINE_THICKNESS_PERCENT,
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
  const { t } = useTranslation();
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

  // 弹窗内两列：左侧是会随窗口长大的预览工作面（沉一级、不描边），右侧是参数分组。
  // 原来右列整块是带描边的卡片、里面的统计又是一层卡片，加上弹窗本身共三层边框（任务 5.4）。
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-2">
        <div className={`flex items-center justify-between ${UI_TEXT_META_CLASS}`}>
          <span>{t('toolDialog.split.preview')}</span>
          {naturalSize && (
            <span className={UI_TEXT_NUMERIC_CLASS}>
              {t('toolDialog.split.sourceSize', { width: naturalSize.width, height: naturalSize.height })}
            </span>
          )}
        </div>

        <div
          className={`ui-scrollbar flex ${PREVIEW_VIEWPORT_HEIGHT} items-center justify-center overflow-auto rounded-lg bg-gap p-3`}
        >
          <div className="relative inline-flex items-center justify-center">
            <img
              src={displaySourceImageUrl}
              alt={t('toolDialog.split.preview')}
              className="max-h-full w-auto max-w-full object-contain"
              onLoad={(event) => {
                const target = event.currentTarget;
                setNaturalSize({
                  width: Math.max(1, target.naturalWidth),
                  height: Math.max(1, target.naturalHeight),
                });
              }}
            />

            {naturalSize && layout && (
              <div className="pointer-events-none absolute inset-0">
                {layout.lineRects.map((rect, index) => (
                  <div
                    key={`line-${index}`}
                    className="absolute bg-danger-hi/40"
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
                    className="absolute border border-on-media/40"
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

        <div className={`inline-flex items-center gap-2 ${UI_TEXT_META_CLASS}`}>
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-danger-hi/70" />
          {t('toolDialog.split.discardLegend')}
        </div>
      </div>

      <UiGroup title={t('toolDialog.split.settings')}>
        <UiFormRow label={t('toolDialog.split.rows')} inline>
          <NumberField
            value={rows}
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            step={1}
            align="center"
            widthClassName="w-24"
            ariaLabel={t('toolDialog.split.rows')}
            onChange={(value) => updateOptions({ rows: value })}
          />
        </UiFormRow>
        <UiFormRow label={t('toolDialog.split.cols')} inline>
          <NumberField
            value={cols}
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            step={1}
            align="center"
            widthClassName="w-24"
            ariaLabel={t('toolDialog.split.cols')}
            onChange={(value) => updateOptions({ cols: value })}
          />
        </UiFormRow>
        <UiFormRow
          label={t('toolDialog.split.lineThickness')}
          hint={naturalSize ? t('toolDialog.split.lineThicknessPx', { px: lineThicknessPx }) : undefined}
        >
          <div className="flex items-center gap-3">
            <UiRangeInput
              className="min-w-0 flex-1"
              min={0}
              max={Math.max(0, maxLineThicknessPercent)}
              step={0.1}
              value={lineThicknessPercent}
              aria-label={t('toolDialog.split.lineThickness')}
              onChange={(event) => updateOptions({ lineThicknessPercent: Number(event.target.value) })}
            />
            <NumberField
              value={lineThicknessPercent}
              min={0}
              max={Math.max(0, maxLineThicknessPercent)}
              step={0.1}
              precision={1}
              align="center"
              widthClassName="w-24"
              ariaLabel={t('toolDialog.split.lineThickness')}
              onChange={(value) => updateOptions({ lineThicknessPercent: value })}
            />
          </div>
        </UiFormRow>

        <UiPanel variant="inset" className={`space-y-1 px-3 py-2 ${UI_TEXT_META_CLASS}`}>
          <div className="flex items-center justify-between">
            <span>{t('toolDialog.split.cellCount')}</span>
            <span className={`font-medium text-text1 ${UI_TEXT_NUMERIC_CLASS}`}>{rows * cols}</span>
          </div>
          {layout && (
            <>
              <div className="flex items-center justify-between">
                <span>{t('toolDialog.split.cellWidth')}</span>
                <span className={UI_TEXT_NUMERIC_CLASS}>{splitSizeLabel(layout.minCellWidth, layout.maxCellWidth)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('toolDialog.split.cellHeight')}</span>
                <span className={UI_TEXT_NUMERIC_CLASS}>{splitSizeLabel(layout.minCellHeight, layout.maxCellHeight)}</span>
              </div>
            </>
          )}
        </UiPanel>

        {hasLayoutError && (
          <UiError size="xs" align="start" message={t('toolDialog.split.layoutError')} />
        )}
      </UiGroup>
    </div>
  );
}
