import { Brush, Eraser } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  UI_TEXT_META_CLASS,
  UiError,
  UiGroup,
  UiFormRow,
  UiSegmented,
  UiRangeInput,
} from '@/components/ui';
import { MIN_MASK_BRUSH_HARDNESS } from './brushHardness';
import type { MaskStrokeMode, MaskTool } from './types';

interface MaskEditorInspectorProps {
  mode: MaskStrokeMode;
  tool: MaskTool;
  brushSize: number;
  brushHardness: number;
  maxBrushSize: number;
  confirmError: string | null;
  onModeChange: (mode: MaskStrokeMode) => void;
  onBrushSizeChange: (size: number) => void;
  onBrushHardnessChange: (hardness: number) => void;
}

function operationInstruction(tool: MaskTool, mode: MaskStrokeMode): string {
  const action = mode === 'paint' ? '加入重绘遮罩' : '从重绘遮罩中移除';
  if (tool === 'brush') return `拖动圆形画笔，将经过的区域${action}。`;
  if (tool === 'rectangle') return `拖动框出矩形区域，松开后${action}。`;
  if (tool === 'circle') return `拖动框出圆形区域，松开后${action}。`;
  return `沿目标边缘自由绘制，松开后会自动连接首尾并${action}。`;
}

export function MaskEditorInspector({
  mode,
  tool,
  brushSize,
  brushHardness,
  maxBrushSize,
  confirmError,
  onModeChange,
  onBrushSizeChange,
  onBrushHardnessChange,
}: MaskEditorInspectorProps): JSX.Element {
  const { t } = useTranslation('ui');
  const hardnessPercent = Math.round(brushHardness * 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <UiGroup labelWidth={72}>
        <UiFormRow label={t('maskInspector.mode')} density="compact">
          <UiSegmented ariaLabel={t('maskInspector.mode')} value={mode} onChange={onModeChange} size="sm"
            options={[
              { value: 'paint', label: t('maskInspector.paint'), icon: <Brush className="h-4 w-4" />, title: t('maskInspector.paintShortcut') },
              { value: 'erase', label: t('maskInspector.erase'), icon: <Eraser className="h-4 w-4" />, title: t('maskInspector.eraseShortcut') },
            ]} />
        </UiFormRow>
      </UiGroup>
      {tool === 'brush' && <UiGroup labelWidth={72} divided className="mt-4" title={t('maskInspector.brush')} titleTone="overline">
        <UiFormRow label={t('maskInspector.size')} density="compact">
          <div className="flex items-center gap-2">
            <UiRangeInput aria-label={t('maskInspector.brushSize')} min={1} max={maxBrushSize} step={1} value={brushSize}
              onChange={event => onBrushSizeChange(Number(event.target.value))} />
            <span className={`shrink-0 tabular-nums ${UI_TEXT_META_CLASS}`}>{Math.round(brushSize)} px</span>
          </div>
        </UiFormRow>
        <UiFormRow label={t('maskInspector.hardness')} density="compact">
          <div className="flex items-center gap-2">
            <UiRangeInput aria-label={t('maskInspector.brushHardness')} min={MIN_MASK_BRUSH_HARDNESS * 100} max={100} step={1} value={hardnessPercent}
              onChange={event => onBrushHardnessChange(Number(event.target.value) / 100)} />
            <span className={`shrink-0 tabular-nums ${UI_TEXT_META_CLASS}`}>{hardnessPercent}%</span>
          </div>
        </UiFormRow>
      </UiGroup>}

      <UiGroup divided className="mt-4" title="操作说明" titleTone="overline">
        <p className={`leading-5 ${UI_TEXT_META_CLASS}`}>
          {operationInstruction(tool, mode)}
        </p>
      </UiGroup>

      {confirmError ? (
        <UiError title="遮罩保存失败" message={confirmError} size="sm" />
      ) : null}
    </div>
  );
}
