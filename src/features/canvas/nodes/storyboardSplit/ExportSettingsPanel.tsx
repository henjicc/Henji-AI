import type { StoryboardExportOptions } from '@/features/canvas/domain/canvasNodes';
import NumberField from '@/components/ui/NumberInput';
import {
  UiColorInput,
  UiCheckbox,
  UiInput,
  UiSelect,
} from '@/components/ui';

interface StoryboardExportSettingsPanelProps {
  exportOptions: StoryboardExportOptions;
  onPatch: (patch: Partial<StoryboardExportOptions>) => void;
}

/**
 * 导出设置的面板内容。浮层外壳（定位、玻璃表面、点外与 Escape 关闭、浮层归属）由
 * `StoryboardNode` 里的 `PanelTrigger` 提供（任务 5.9）。
 */
export function StoryboardExportSettingsPanel({
  exportOptions,
  onPatch,
}: StoryboardExportSettingsPanelProps): JSX.Element {
  return (
    <div className="space-y-2 text-xs text-text2">
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
            
            onChange={(event) => onPatch({ frameIndexPrefix: event.target.value })}
            textHistory={{ onValueChange: (value) => onPatch({ frameIndexPrefix: value }) }}
          />
        </div>
        <div>
          <div className="mb-1">描述位置</div>
          <UiSelect
            
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
            size="sm"
            align="center"
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
            size="sm"
            align="center"
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
          <span className="shrink-0 whitespace-nowrap">背景</span>
          <UiColorInput
            value={exportOptions.backgroundColor}
            onChange={(event) => onPatch({ backgroundColor: event.target.value })}
            className="h-7 w-full"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="shrink-0 whitespace-nowrap">文字</span>
          <UiColorInput
            value={exportOptions.textColor}
            onChange={(event) => onPatch({ textColor: event.target.value })}
            className="h-7 w-full"
          />
        </label>
      </div>
    </div>
  );
}
