import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { clamp } from '../domain/geometry';
import {
  MAX_LINE_WIDTH_PERCENT,
  MAX_MOSAIC_STRENGTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_MOSAIC_STRENGTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
  fontSizeToPercent,
  lineWidthToPercent,
  percentToFontSize,
  percentToLineWidth,
} from '../domain/metrics';
import { isLabeledMark, type ImageMarkDoc, type MarkItem } from '../domain/types';
import type { MarkEditorStyleState } from './shared';

export type NumericStyleKey = 'lineWidthPercent' | 'textSizePercent' | 'mosaicStrengthPercent';

export interface UseMarkStyleSyncParams {
  docRef: MutableRefObject<ImageMarkDoc>;
  selectedItem: MarkItem | null;
  /** 标签是否为当前激活的子选中目标;激活时滚轮调节标签字号而非父图形线宽 */
  activeLabelId: string | null;
  style: MarkEditorStyleState;
  setStyle: Dispatch<SetStateAction<MarkEditorStyleState>>;
  onStyleChange?: (style: MarkEditorStyleState) => void;
  baseSize: number;
  commitItems: (items: MarkItem[], recordHistory?: boolean) => void;
  pushHistorySnapshot: (doc: ImageMarkDoc) => void;
  /** 原位文字输入期间不做选中项 → 样式面板的反向同步 */
  isTextEditorOpen: boolean;
}

/** 工具栏样式(颜色/线宽/字号/打码/标注形状)与选中项的双向同步、滚轮微调 */
export function useMarkStyleSync({
  docRef,
  selectedItem,
  activeLabelId,
  style,
  setStyle,
  onStyleChange,
  baseSize,
  commitItems,
  pushHistorySnapshot,
  isTextEditorOpen,
}: UseMarkStyleSyncParams) {
  // ==================== 样式变更(同时作用于选中项) ====================

  const applyStylePatch = useCallback((patch: Partial<MarkEditorStyleState>, recordHistory: boolean) => {
    const nextStyle: MarkEditorStyleState = {
      color: patch.color ?? style.color,
      textBackgroundEnabled: patch.textBackgroundEnabled ?? style.textBackgroundEnabled,
      textBackgroundColor: patch.textBackgroundColor ?? style.textBackgroundColor,
      lineWidthPercent: clamp(
        patch.lineWidthPercent ?? style.lineWidthPercent,
        MIN_LINE_WIDTH_PERCENT,
        MAX_LINE_WIDTH_PERCENT
      ),
      textSizePercent: clamp(
        patch.textSizePercent ?? style.textSizePercent,
        MIN_TEXT_SIZE_PERCENT,
        MAX_TEXT_SIZE_PERCENT
      ),
      mosaicStrengthPercent: clamp(
        patch.mosaicStrengthPercent ?? style.mosaicStrengthPercent,
        MIN_MOSAIC_STRENGTH_PERCENT,
        MAX_MOSAIC_STRENGTH_PERCENT
      ),
      mosaicMode: patch.mosaicMode ?? style.mosaicMode,
      calloutShape: patch.calloutShape ?? style.calloutShape,
    };
    setStyle(nextStyle);
    onStyleChange?.(nextStyle);

    if (!selectedItem) {
      return;
    }
    const nextItems = docRef.current.items.map((item) => {
      if (item.id !== selectedItem.id) {
        return item;
      }
      if (item.type === 'text') {
        const next = {
          ...item,
          color: nextStyle.color,
          fontSize: percentToFontSize(nextStyle.textSizePercent, baseSize),
        };
        if (nextStyle.textBackgroundEnabled) {
          return { ...next, backgroundColor: nextStyle.textBackgroundColor };
        }
        const { backgroundColor: _background, ...withoutBackground } = next;
        return withoutBackground;
      }
      if (item.type === 'number') {
        return {
          ...item,
          color: nextStyle.color,
          fontSize: percentToFontSize(nextStyle.textSizePercent, baseSize),
        };
      }
      if (item.type === 'mosaic') {
        return {
          ...item,
          strengthPercent: nextStyle.mosaicStrengthPercent,
          mode: nextStyle.mosaicMode,
        };
      }
      const next = {
        ...item,
        stroke: nextStyle.color,
        lineWidth: percentToLineWidth(nextStyle.lineWidthPercent, baseSize),
      };
      // 带标签的图形:字号设置同时作用于标签文字
      if (isLabeledMark(next) && next.label) {
        let labeled = patch.textSizePercent !== undefined
          ? { ...next, labelFontSize: percentToFontSize(nextStyle.textSizePercent, baseSize) }
          : next;
        if (patch.textBackgroundEnabled !== undefined || patch.textBackgroundColor !== undefined) {
          if (nextStyle.textBackgroundEnabled) {
            labeled = { ...labeled, labelBackgroundColor: nextStyle.textBackgroundColor };
          } else {
            const { labelBackgroundColor: _background, ...withoutBackground } = labeled;
            labeled = withoutBackground;
          }
        }
        return labeled;
      }
      return next;
    });
    commitItems(nextItems, recordHistory);
  }, [baseSize, commitItems, docRef, onStyleChange, selectedItem, setStyle, style]);

  const handleStylePatch = useCallback((patch: Partial<MarkEditorStyleState>) => {
    applyStylePatch(patch, true);
  }, [applyStylePatch]);

  // ==================== 滚轮微调(合并为一次历史) ====================

  const wheelGestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginWheelGesture = useCallback(() => {
    if (wheelGestureTimerRef.current === null) {
      pushHistorySnapshot(docRef.current);
    } else {
      clearTimeout(wheelGestureTimerRef.current);
    }
    wheelGestureTimerRef.current = setTimeout(() => {
      wheelGestureTimerRef.current = null;
    }, 600);
  }, [docRef, pushHistorySnapshot]);

  /** 滑块悬停滚轮:调节对应样式值(选中项跟随变化) */
  const adjustStyleByWheel = useCallback((key: NumericStyleKey, deltaY: number) => {
    const direction = deltaY < 0 ? 1 : -1;
    const step = key === 'lineWidthPercent' ? 0.1 : 0.5;
    if (selectedItem) {
      beginWheelGesture();
    }
    applyStylePatch({ [key]: style[key] + direction * step }, false);
  }, [applyStylePatch, beginWheelGesture, selectedItem, style]);

  /** 画布上滚轮:按选中项类型调节线宽/字号/打码强度;标签为激活子目标时调节标签字号 */
  const adjustSelectedByWheel = useCallback((deltaY: number): boolean => {
    if (!selectedItem) {
      return false;
    }
    if (activeLabelId === selectedItem.id && isLabeledMark(selectedItem) && selectedItem.label) {
      adjustStyleByWheel('textSizePercent', deltaY);
      return true;
    }
    const key: NumericStyleKey =
      selectedItem.type === 'text' || selectedItem.type === 'number'
        ? 'textSizePercent'
        : selectedItem.type === 'mosaic'
          ? 'mosaicStrengthPercent'
          : 'lineWidthPercent';
    adjustStyleByWheel(key, deltaY);
    return true;
  }, [activeLabelId, adjustStyleByWheel, selectedItem]);

  // 选中项变化时,把样式面板同步为该项的样式
  useEffect(() => {
    if (!selectedItem || isTextEditorOpen) {
      return;
    }
    let patch: Partial<MarkEditorStyleState> = {};
    if (selectedItem.type === 'text') {
      patch = {
        color: selectedItem.color,
        textBackgroundEnabled: Boolean(selectedItem.backgroundColor),
        textBackgroundColor: selectedItem.backgroundColor ?? style.textBackgroundColor,
        textSizePercent: clamp(
          fontSizeToPercent(selectedItem.fontSize, baseSize),
          MIN_TEXT_SIZE_PERCENT,
          MAX_TEXT_SIZE_PERCENT
        ),
      };
    } else if (selectedItem.type === 'number') {
      patch = {
        color: selectedItem.color,
        textSizePercent: clamp(
          fontSizeToPercent(selectedItem.fontSize, baseSize),
          MIN_TEXT_SIZE_PERCENT,
          MAX_TEXT_SIZE_PERCENT
        ),
      };
    } else if (selectedItem.type === 'mosaic') {
      patch = {
        mosaicStrengthPercent: clamp(
          selectedItem.strengthPercent ?? style.mosaicStrengthPercent,
          MIN_MOSAIC_STRENGTH_PERCENT,
          MAX_MOSAIC_STRENGTH_PERCENT
        ),
        mosaicMode: selectedItem.mode ?? 'pixel',
      };
    } else {
      patch = {
        color: selectedItem.stroke,
        lineWidthPercent: clamp(
          lineWidthToPercent(selectedItem.lineWidth, baseSize),
          MIN_LINE_WIDTH_PERCENT,
          MAX_LINE_WIDTH_PERCENT
        ),
      };
      if (isLabeledMark(selectedItem) && selectedItem.label && selectedItem.labelFontSize) {
        patch.textSizePercent = clamp(
          fontSizeToPercent(selectedItem.labelFontSize, baseSize),
          MIN_TEXT_SIZE_PERCENT,
          MAX_TEXT_SIZE_PERCENT
        );
      }
      if (isLabeledMark(selectedItem) && selectedItem.label) {
        patch.textBackgroundEnabled = Boolean(selectedItem.labelBackgroundColor);
        patch.textBackgroundColor = selectedItem.labelBackgroundColor ?? style.textBackgroundColor;
      }
    }
    setStyle((previous) => {
      const next = { ...previous, ...patch };
      const changed = Object.entries(patch).some(
        ([key, value]) => !Object.is(previous[key as keyof MarkEditorStyleState], value)
      );
      return changed ? next : previous;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在选中项变化时同步一次样式
  }, [selectedItem?.id]);

  return {
    handleStylePatch,
    adjustStyleByWheel,
    adjustSelectedByWheel,
  };
}
