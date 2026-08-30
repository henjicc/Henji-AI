import { memo, useCallback, useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'

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
  type CanvasNodeData,
  type PortraitTextureGenerationNodeData,
} from '@/features/canvas/domain/canvasNodes'
import {
  GenerationNodeShell,
  type GenerationNodeRuntimePreparationContext,
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
  const { t } = useTranslation()
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const settings = useMemo(
    () => readSettings(data.portraitTextureSettings),
    [data.portraitTextureSettings],
  )
  const prepareRuntimeParams = useCallback(({
    data: runtimeData,
  }: GenerationNodeRuntimePreparationContext): DynamicValueMap => {
    // 未知版本必须在付费请求前拒绝；界面可安全展示，但不会静默降级生成。
    normalizePortraitTextureSettings(
      (runtimeData as PortraitTextureGenerationNodeData).portraitTextureSettings,
    )
    return {}
  }, [])

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

  const resultNodeExtraData = useCallback((runtimeData: CanvasNodeData): DynamicValueMap => ({
    generationPortraitTextureSettings: (
      runtimeData as PortraitTextureGenerationNodeData
    ).portraitTextureSettings as unknown as DynamicValue,
  }), [])

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
      layoutMode="workbench"
      workbenchSummary={t('node.portraitTextureGeneration.workbenchSummary')}
      minHeight={320}
    />
  )
})

PortraitTextureGenerationNode.displayName = 'PortraitTextureGenerationNode'
