import { memo } from 'react'
import type { ImageSize } from '@/features/canvas/domain/canvasNodes'
import type { ImageModelDefinition } from '@/features/canvas/models'
import { ModelParamsControls } from '@/features/canvas/ui/ModelParamsControls'
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import { UiButton } from '@/components/ui'
import type { AspectRatioChoice } from './shared'
import type { StoryboardFrameLayout } from './layout'
import { Sparkles } from 'lucide-react'

interface StoryboardParamsBarProps {
  frameLayout: StoryboardFrameLayout
  imageModels: ImageModelDefinition[]
  selectedModel: ImageModelDefinition
  selectedResolution: AspectRatioChoice
  selectedAspectRatio: AspectRatioChoice
  aspectRatioOptions: AspectRatioChoice[]
  onModelChange: (modelId: string) => void
  onResolutionChange: (resolution: ImageSize) => void
  onAspectRatioChange: (aspectRatio: string) => void
  onGenerate: () => void
}

export const StoryboardParamsBar = memo(({
  frameLayout,
  imageModels,
  selectedModel,
  selectedResolution,
  selectedAspectRatio,
  aspectRatioOptions,
  onModelChange,
  onResolutionChange,
  onAspectRatioChange,
  onGenerate,
}: StoryboardParamsBarProps): JSX.Element => {
  return (
    <div
      className="relative mx-auto mt-auto flex shrink-0 items-center justify-between"
      style={{ width: `${frameLayout.paramsRowWidth}px` }}
    >
      <ModelParamsControls
        imageModels={imageModels}
        selectedModel={selectedModel}
        selectedResolution={selectedResolution}
        selectedAspectRatio={selectedAspectRatio}
        aspectRatioOptions={aspectRatioOptions}
        onModelChange={onModelChange}
        onResolutionChange={(resolution) => onResolutionChange(resolution as ImageSize)}
        onAspectRatioChange={onAspectRatioChange}
        triggerSize="sm"
        chipClassName={NODE_CONTROL_CHIP_CLASS}
        modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
        paramsChipClassName={NODE_CONTROL_PARAMS_CHIP_CLASS}
        modelPanelAlign="center"
        paramsPanelAlign="center"
        modelPanelClassName="w-[360px] p-2"
        paramsPanelClassName="w-[420px] p-3"
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
