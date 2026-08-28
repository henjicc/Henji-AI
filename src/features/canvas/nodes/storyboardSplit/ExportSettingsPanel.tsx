import { createPortal } from 'react-dom';
import type { StoryboardExportOptions } from '@/features/canvas/domain/canvasNodes';
import NumberField from '@/components/ui/NumberInput';
import {
  UiColorInput,
  UiCheckbox,
  UiInput,
  UiPanel,
  UiSelect,
} from '@/components/ui';
import type { PanelAnchor } from './shared';

interface StoryboardExportSettingsPanelProps {
  isOpen: boolean;
  isVisible: boolean;
  anchor: PanelAnchor | null;
  panelRef: { current: HTMLDivElement | null };
  exportOptions: StoryboardExportOptions;
  onPatch: (patch: Partial<StoryboardExportOptions>) => void;
}

export function StoryboardExportSettingsPanel({
  isOpen,
  isVisible,
  anchor,
  panelRef,
  exportOptions,
  onPatch,
}: StoryboardExportSettingsPanelProps): JSX.Element | null {
  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed z-dropdown w-[340px] transition-opacity duration-200 ease-out ${isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      style={anchor
        ? {
          left: anchor.left,
          top: anchor.top,
          transform: 'translateX(-50%) translateY(-100%)',
        }
        : undefined}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <UiPanel className="p-2.5">
        <div className="space-y-2 text-xs text-text-muted">
          <label className="flex items-center gap-2">
            <UiCheckbox
              checked={exportOptions.showFrameIndex}
              onCheckedChange={(checked) => onPatch({ showFrameIndex: checked })}
            />
            显示分镜序号
          </label>

          <label className="flex items-center gap-2">
            <UiCheckbox
              checked={exportOptions.showFrameNote}
              onCheckedChange={(checked) => onPatch({ showFrameNote: checked })}
            />
            显示分镜描述
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1">图片填充</div>
              <UiSelect
                className="h-8 text-xs"
                value={exportOptions.imageFit}
                onChange={(event) =>
                  onPatch({
                    imageFit: event.target.value === 'contain' ? 'contain' : 'cover',
                  })
                }
              >
                <option value="cover">填充满格子</option>
                <option value="contain">完整显示</option>
              </UiSelect>
            </div>
            <div>
              <div className="mb-1">序号前缀</div>
              <UiInput
                value={exportOptions.frameIndexPrefix}
                maxLength={4}
                className="h-8"
                onChange={(event) => onPatch({ frameIndexPrefix: event.target.value })}
                textHistory={{ onValueChange: (value) => onPatch({ frameIndexPrefix: value }) }}
              />
            </div>
            <div>
              <div className="mb-1">描述位置</div>
              <UiSelect
                className="h-8 text-xs"
                value={exportOptions.notePlacement}
                onChange={(event) =>
                  onPatch({
                    notePlacement: event.target.value === 'bottom' ? 'bottom' : 'overlay',
                  })
                }
              >
                <option value="overlay">图上遮罩</option>
                <option value="bottom">图下文字</option>
              </UiSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1">间距</div>
              <NumberField
                min={0}
                max={120}
                value={exportOptions.cellGap}
                onChange={(value) => onPatch({ cellGap: value || 0 })}
                textHistory={{ onValueChange: (value) => onPatch({ cellGap: Number(value) || 0 }) }}
                size="compact"
                align="right"
                widthClassName="w-full"
                commitOnChange
                ariaLabel="分镜间距"
                increaseLabel="增加分镜间距"
                decreaseLabel="减少分镜间距"
              />
            </div>
            <div>
              <div className="mb-1">字号(%)</div>
              <NumberField
                min={1}
                max={20}
                value={exportOptions.fontSize}
                onChange={(value) => onPatch({ fontSize: value || 4 })}
                textHistory={{ onValueChange: (value) => onPatch({ fontSize: Number(value) || 4 }) }}
                size="compact"
                align="right"
                widthClassName="w-full"
                commitOnChange
                ariaLabel="分镜字号"
                increaseLabel="增加分镜字号"
                decreaseLabel="减少分镜字号"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2">
              <span>背景</span>
              <UiColorInput
                value={exportOptions.backgroundColor}
                onChange={(event) => onPatch({ backgroundColor: event.target.value })}
                className="h-7 w-full"
              />
            </label>
            <label className="flex items-center gap-2">
              <span>文字</span>
              <UiColorInput
                value={exportOptions.textColor}
                onChange={(event) => onPatch({ textColor: event.target.value })}
                className="h-7 w-full"
              />
            </label>
          </div>
        </div>
      </UiPanel>
    </div>,
    document.body
  );
}
