import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'

import { readImageInfo } from '@/commands/image'
import { registry } from '@/core/ModelRegistry'
import { ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons'
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  prepareElementEditPreflight,
} from '@/features/canvas/capabilities'
import {
  CANVAS_NODE_TYPES,
  type ElementEditGenerationNodeData,
} from '@/features/canvas/domain/canvasNodes'
import {
  GenerationNodeShell,
  type GenerationNodeRuntimePreparationContext,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell'

type ElementEditGenerationNodeProps = NodeProps & {
  id: string
  data: ElementEditGenerationNodeData
  selected?: boolean
}

const ElementEditIcon = ICON_TOOL_IMAGE_EDIT

/**
 * 标准图片生成壳上的元素编辑节点。遮罩创作仍由 schema 的
 * DerivedMediaParamControl 接管，这里只补付费前的真实文件预检。
 */
export const ElementEditGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ElementEditGenerationNodeProps) => {
  const prepareRuntimeParams = useCallback(async ({
    images,
    params,
    modelId,
  }: GenerationNodeRuntimePreparationContext): Promise<DynamicValueMap> => (
    await prepareElementEditPreflight({
      model: registry.getModel(modelId),
      images,
      params,
      readImageInfo,
    })
  ), [])

  return (
    <GenerationNodeShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.elementEditGen}
      data={data as GenerationNodeShellData}
      selected={selected}
      width={width}
      height={height}
      icon={<ElementEditIcon className="h-4 w-4" />}
      capabilityId={CANVAS_IMAGE_CAPABILITY_IDS.elementEdit}
      promptPlaceholderKey="node.elementEditGeneration.promptPlaceholder"
      promptRequiredKey="node.elementEditGeneration.promptRequired"
      apiKeyRequiredKey="node.elementEditGeneration.apiKeyRequired"
      resultTitleKey="node.elementEditGeneration.resultTitle"
      prepareRuntimeParams={prepareRuntimeParams}
      minHeight={176}
    />
  )
})

ElementEditGenerationNode.displayName = 'ElementEditGenerationNode'
