import { memo } from 'react'
import { NodeModelParamsControls } from '@/features/canvas/params/NodeModelParamsControls'
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import { UiButton } from '@/components/ui'
import PriceEstimate from '@/components/ui/PriceEstimate'
import type { StoryboardFrameLayout } from './layout'
import { Sparkles } from 'lucide-react'

interface StoryboardParamsBarProps {
  frameLayout: StoryboardFrameLayout
  modelId: string
  providerId: string
  storedParams: DynamicValueMap | undefined
  /** 默认值合并后的运行时参数（用于价格估算） */
  mergedParams: DynamicValueMap
  incomingImages: string[]
  onModelChange: (modelId: string) => void
  onParamsChange: (nextParams: DynamicValueMap) => void
  onGenerate: () => void
}

export const StoryboardParamsBar = memo(({
  frameLayout,
  modelId,
  providerId,
  storedParams,
  mergedParams,
  incomingImages,
  onModelChange,
  onParamsChange,
  onGenerate,
}: StoryboardParamsBarProps): JSX.Element => {
  return (
    <div
      className="relative mx-auto mt-auto flex shrink-0 items-center justify-between gap-1"
      style={{ width: `${frameLayout.paramsRowWidth}px` }}
    >
      <NodeModelParamsControls
        mediaType="image"
        modelId={modelId}
        storedParams={storedParams}
        incomingImages={incomingImages}
        onModelChange={onModelChange}
        onParamsChange={onParamsChange}
        chipClassName={NODE_CONTROL_CHIP_CLASS}
        modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
        paramsChipClassName={NODE_CONTROL_PARAMS_CHIP_CLASS}
      />

      <div className="ml-auto" />

      <PriceEstimate
        providerId={providerId}
        modelId={modelId}
        params={mergedParams}
        variant="badge"
      />

      <UiButton
        onClick={(event) => {
          event.stopPropagation()
          onGenerate()
        }}
        variant="primary"
        size="sm"
        className={`!min-w-0 shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
      >
        <Sparkles className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
        生成
      </UiButton>
    </div>
  )
})

StoryboardParamsBar.displayName = 'StoryboardParamsBar'
