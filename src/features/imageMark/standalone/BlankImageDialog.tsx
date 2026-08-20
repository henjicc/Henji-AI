import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import {
  UI_FIELD_LABEL_CLASS,
  UI_FIELD_CONTROL_HEIGHT_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiColorInput,
  UiIconButton,
  UiInput,
  UiModal,
  UiOptionButton,
} from '@/components/ui';
import {
  BLANK_IMAGE_BACKGROUND_PRESET_HEX,
  WHITE_HEX,
} from '@/core/theme/colorTokens';
import {
  validateBlankImageSpec,
  type BlankImageSpec,
} from './blankImage';

interface BlankImageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (spec: BlankImageSpec) => void;
}

const SIZE_PRESETS = [
  { label: '全高清', detail: '1920 × 1080', width: 1920, height: 1080 },
  { label: '方形', detail: '1080 × 1080', width: 1080, height: 1080 },
  { label: '竖屏', detail: '1080 × 1920', width: 1080, height: 1920 },
  { label: '4K', detail: '3840 × 2160', width: 3840, height: 2160 },
] as const;

const COLOR_LABELS = ['白色', '浅灰', '黑色'] as const;

function parseInteger(value: string): number {
  return Number.parseInt(value, 10);
}

export function BlankImageDialog({ isOpen, onClose, onCreate }: BlankImageDialogProps): JSX.Element {
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [dpi, setDpi] = useState(72);
  const [backgroundColor, setBackgroundColor] = useState<string>(WHITE_HEX);

  useEffect(() => {
    if (!isOpen) return;
    setWidth(1920);
    setHeight(1080);
    setDpi(72);
    setBackgroundColor(WHITE_HEX);
  }, [isOpen]);

  const spec = useMemo<BlankImageSpec>(() => ({
    width,
    height,
    dpi,
    backgroundColor,
  }), [backgroundColor, dpi, height, width]);
  const validationError = validateBlankImageSpec(spec);

  return (
    <UiModal
      isOpen={isOpen}
      title="新建空白图片"
      size="form"
      onClose={onClose}
      footer={(
        <>
          <UiButton variant="ghost" size="sm" onClick={onClose}>取消</UiButton>
          <UiButton
            variant="primary"
            size="sm"
            disabled={Boolean(validationError)}
            onClick={() => onCreate(spec)}
          >
            创建图片
          </UiButton>
        </>
      )}
    >
      <div className="space-y-5">
        <section>
          <div className={UI_FIELD_LABEL_CLASS}>常用尺寸</div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-veil-faint p-1">
            {SIZE_PRESETS.map((preset) => {
              const active = width === preset.width && height === preset.height;
              return (
                <UiOptionButton
                  key={`${preset.width}x${preset.height}`}
                  type="button"
                  variant="menu"
                  active={active}
                  className="flex-col items-start"
                  onClick={() => {
                    setWidth(preset.width);
                    setHeight(preset.height);
                  }}
                >
                  <span className="text-sm font-medium">{preset.label}</span>
                  <span className={UI_TEXT_META_CLASS}>{preset.detail} px</span>
                </UiOptionButton>
              );
            })}
          </div>
        </section>

        <section>
          <div className={UI_FIELD_LABEL_CLASS}>自定义尺寸</div>
          <div className="grid grid-cols-[1fr_auto_1fr_1fr] items-end gap-2">
            <label>
              <span className={UI_FIELD_LABEL_CLASS}>宽度（px）</span>
              <UiInput
                type="number"
                min={16}
                max={8192}
                value={Number.isNaN(width) ? '' : width}
                onChange={(event) => setWidth(parseInteger(event.target.value))}
              />
            </label>
            <UiIconButton
              type="button"
              className={UI_FIELD_CONTROL_HEIGHT_CLASS}
              aria-label="互换宽度和高度"
              title="互换宽度和高度"
              onClick={() => {
                setWidth(height);
                setHeight(width);
              }}
            >
              <ArrowLeftRight size={16} />
            </UiIconButton>
            <label>
              <span className={UI_FIELD_LABEL_CLASS}>高度（px）</span>
              <UiInput
                type="number"
                min={16}
                max={8192}
                value={Number.isNaN(height) ? '' : height}
                onChange={(event) => setHeight(parseInteger(event.target.value))}
              />
            </label>
            <label>
              <span className={UI_FIELD_LABEL_CLASS}>DPI</span>
              <UiInput
                type="number"
                min={1}
                max={1200}
                value={Number.isNaN(dpi) ? '' : dpi}
                onChange={(event) => setDpi(parseInteger(event.target.value))}
              />
            </label>
          </div>
          <div className={`mt-2 ${UI_TEXT_META_CLASS}`}>
            DPI 会写入导出的 PNG，用于打印尺寸；屏幕上的像素尺寸不变。
          </div>
        </section>

        <section>
          <div className={UI_FIELD_LABEL_CLASS}>背景色</div>
          <div className="flex items-center gap-2">
            {BLANK_IMAGE_BACKGROUND_PRESET_HEX.map((color, index) => (
              <UiOptionButton
                key={color}
                type="button"
                variant="flat"
                active={backgroundColor.toLowerCase() === color.toLowerCase()}
                className="gap-2"
                onClick={() => setBackgroundColor(color)}
              >
                <span
                  className="h-5 w-5 rounded-full border border-veil-soft"
                  style={{ backgroundColor: color }}
                />
                {COLOR_LABELS[index]}
              </UiOptionButton>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm text-text-muted">
              自定义
              <UiColorInput
                value={backgroundColor}
                aria-label="自定义背景色"
                onChange={(event) => setBackgroundColor(event.target.value)}
              />
            </label>
          </div>
        </section>

        <div className={`min-h-5 ${validationError ? 'text-danger' : UI_TEXT_META_CLASS}`}>
          {validationError ?? `将创建 ${width} × ${height} 像素的空白 PNG`}
        </div>
      </div>
    </UiModal>
  );
}
