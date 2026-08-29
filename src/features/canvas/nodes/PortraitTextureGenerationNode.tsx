import { memo, useCallback, useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'

import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument'
import { ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons'
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  DEFAULT_PORTRAIT_TEXTURE_SETTINGS,
  PORTRAIT_TEXTURE_TEMPLATE_VERSION,
  compilePortraitTexturePrompt,
  normalizePortraitTextureSettings,
  type PortraitTextureSettingsV1,
} from '@/features/canvas/capabilities'
import {
  CANVAS_NODE_TYPES,
  type PortraitTextureGenerationNodeData,
} from '@/features/canvas/domain/canvasNodes'
import {
  GenerationNodeShell,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell'
import { useCanvasStore } from '@/stores/canvasStore'
import { PortraitTextureSettingsRows } from './portraitTexture/PortraitTextureSettingsRows'

const PortraitTextureIcon = ICON_TOOL_IMAGE_EDIT

type PortraitTextureGenerationNodeProps = NodeProps & {
  id: string
  data: PortraitTextureGenerationNodeData
  selected?: boolean
}

function readSettings(value: unknown): PortraitTextureSettingsV1 {
  try {
    return normalizePortraitTextureSettings(value)
  } catch {
    return { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS }
  }
}

export const PortraitTextureGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: PortraitTextureGenerationNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const settings = useMemo(
    () => readSettings(data.portraitTextureSettings),
    [data.portraitTextureSettings],
  )
  const prepareRuntimeParams = useCallback((): DynamicValueMap => {
    // 未知版本必须在付费请求前拒绝；界面可安全展示，但不会静默降级生成。
    normalizePortraitTextureSettings(data.portraitTextureSettings)
    return {}
  }, [data.portraitTextureSettings])

  const persistSettings = useCallback((nextSettings: PortraitTextureSettingsV1): void => {
    const prompt = compilePortraitTexturePrompt(nextSettings)
    updateNodeData(id, {
      portraitTextureSettings: nextSettings as unknown as DynamicValue,
      prompt,
      promptDocument: createPlainTextPromptDocument(prompt),
      promptTemplateVersion: PORTRAIT_TEXTURE_TEMPLATE_VERSION,
    })
  }, [id, updateNodeData])

  const setSetting = useCallback((key: string, value: DynamicValue): void => {
    persistSettings(normalizePortraitTextureSettings({
      ...settings,
      ...(key === 'portraitTexturePreset' ? { preset: value } : {}),
      ...(key === 'portraitTextureStrength' ? { strength: value } : {}),
      ...(key === 'portraitTextureUserPrompt' ? { userPrompt: value } : {}),
    }))
  }, [persistSettings, settings])

  const setSettings = useCallback((changes: DynamicValueMap): void => {
    persistSettings(normalizePortraitTextureSettings({
      ...settings,
      ...(Object.prototype.hasOwnProperty.call(changes, 'portraitTexturePreset')
        ? { preset: changes.portraitTexturePreset }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(changes, 'portraitTextureStrength')
        ? { strength: changes.portraitTextureStrength }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(changes, 'portraitTextureUserPrompt')
        ? { userPrompt: changes.portraitTextureUserPrompt }
        : {}),
    }))
  }, [persistSettings, settings])

  const settingsRows = useMemo(() => (
    <PortraitTextureSettingsRows
      nodeId={id}
      settings={settings}
      onSettingChange={setSetting}
      onSettingsChange={setSettings}
    />
  ), [id, setSetting, setSettings, settings])

  const resultNodeExtraData = useMemo<DynamicValueMap>(() => ({
    generationPortraitTextureSettings: settings as unknown as DynamicValue,
  }), [settings])

  return (
    <GenerationNodeShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.portraitTextureGen}
      data={data as GenerationNodeShellData}
      selected={selected}
      width={width}
      height={height}
      icon={<PortraitTextureIcon className="h-4 w-4" />}
      capabilityId={CANVAS_IMAGE_CAPABILITY_IDS.portraitTexture}
      promptPlaceholderKey="node.portraitTextureGeneration.promptPlaceholder"
      promptRequiredKey="node.portraitTextureGeneration.promptRequired"
      apiKeyRequiredKey="node.portraitTextureGeneration.apiKeyRequired"
      resultTitleKey="node.portraitTextureGeneration.resultTitle"
      resultNodeExtraData={resultNodeExtraData}
      showPromptInput={false}
      requirePrompt={false}
      additionalInputRows={settingsRows}
      prepareRuntimeParams={prepareRuntimeParams}
      minHeight={250}
    />
  )
})

PortraitTextureGenerationNode.displayName = 'PortraitTextureGenerationNode'
