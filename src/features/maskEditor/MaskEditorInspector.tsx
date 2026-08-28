import { Brush, Eraser } from 'lucide-react';
import {
  UI_TEXT_META_CLASS,
  UiError,
  UiGroup,
  UiOptionButton,
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
  const hardnessPercent = Math.round(brushHardness * 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <UiGroup title="模式" titleTone="overline">
        <div className="grid grid-cols-2 gap-1">
          <UiOptionButton
            type="button"
            variant="menu"
            active={mode === 'paint'}
            aria-pressed={mode === 'paint'}
            className="justify-center text-xs"
            title="绘制模式(D)"
            onClick={() => onModeChange('paint')}
          >
            <Brush className="h-4 w-4" />
            绘制
          </UiOptionButton>
          <UiOptionButton
            type="button"
            variant="menu"
            active={mode === 'erase'}
            aria-pressed={mode === 'erase'}
            className="justify-center text-xs"
            title="擦除模式(E)"
            onClick={() => onModeChange('erase')}
          >
            <Eraser className="h-4 w-4" />
            擦除
          </UiOptionButton>
        </div>
      </UiGroup>

      {tool === 'brush' ? (
        <UiGroup divided className="mt-4" title="画笔" titleTone="overline">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className={`flex items-center justify-between gap-3 ${UI_TEXT_META_CLASS}`}>
                <span>大小</span>
                <span className="text-text-dark">{Math.round(brushSize)} px</span>
              </div>
              <UiRangeInput
                aria-label="画笔大小"
                min={1}
                max={maxBrushSize}
                step={1}
                value={brushSize}
                onChange={(event) => onBrushSizeChange(Number(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <div className={`flex items-center justify-between gap-3 ${UI_TEXT_META_CLASS}`}>
                <span>硬度</span>
                <span className="text-text-dark">{hardnessPercent}%</span>
              </div>
              <UiRangeInput
                aria-label="画笔硬度"
                min={MIN_MASK_BRUSH_HARDNESS * 100}
                max={100}
                step={1}
                value={hardnessPercent}
                onChange={(event) => onBrushHardnessChange(Number(event.target.value) / 100)}
              />
            </div>
          </div>
        </UiGroup>
      ) : null}

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
