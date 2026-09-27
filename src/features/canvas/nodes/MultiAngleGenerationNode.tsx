import { memo, useMemo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { Camera } from 'lucide-react';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useTranslation } from 'react-i18next';
import { registry } from '@/core/ModelRegistry';
import { getI18nText } from '@/core/types';
import PriceEstimate from '@/components/ui/PriceEstimate';


import { areMediaOutputListsEqual, collectInputMediaByKind } from '@/features/canvas/application/graphMediaResolver';





import { normalizeMultiAngleConfig, resolveMultiAngleExecutionTarget } from '@/features/canvas/capabilities/multiAnglePolicy';

import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';

import { MediaInputRow } from '@/features/canvas/params/MediaInputRow';
import { canvasViewStore, useCanvasStore } from '@/stores/canvasStore';


import { MultiAngleWorkbench } from '@/features/canvas/ui/specialInterfaces/multiAngle/MultiAngleSpecialEditor';
import { buildMultiAngleEditorDraft } from '@/features/canvas/ui/specialInterfaces/multiAngle/multiAngleEditorState';
import { ToolWorkbenchNodeFrame } from './shared/ToolWorkbenchNodeFrame';

import type { MultiAngleGenerationNodeData } from '../application/specialGenerationNodeTypes';

type MultiAngleGenerationNodeProps = NodeProps & {
  id: string
  data: MultiAngleGenerationNodeData
  selected?: boolean
}

export const MultiAngleGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: MultiAngleGenerationNodeProps) => {
  const { t, i18n } = useTranslation()
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false,
  )
  const incomingSourceMedia = useStoreWithEqualityFn(
    canvasViewStore,
    (state) => collectInputMediaByKind(id, state.nodes, state.edges, 'image'),
    areMediaOutputListsEqual,
  )
  const inlineSources = data.mediaInputs?.image ?? []
  const sourceImages = incomingSourceMedia.length > 0
    ? incomingSourceMedia.map((item) => item.url)
    : inlineSources.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  const config = useMemo(() => normalizeMultiAngleConfig(data.multiAngleConfig), [data.multiAngleConfig])
  const priceModel = useMemo(() => registry.getModel(resolveMultiAngleExecutionTarget(config.controlProfile).modelId), [config.controlProfile])
  const priceParams = useMemo(() => data.params ?? {}, [data.params])


  const sourceImage = sourceImages[0] ?? null
  // Selection updates the frame only; retain the workbench instance and its local view state.
  const workbench = useMemo(() => (
        <MultiAngleWorkbench
          config={config}
          sourceImage={sourceImage}
          embedded
          sourceControl={!sourceImage && (
            <MediaInputRow
              showHandle={false}
              nodeId={id}
              mediaKind="image"
              label={t('node.multiAngleGeneration.sourceImage')}
              maxCount={1}
              inlineValue={data.mediaInputs?.image ?? []}
              onInlineChange={(images) => updateNodeData(id, {
                mediaInputs: { ...(data.mediaInputs ?? {}), image: images },
              })}
            />
          )}
          onConfigChange={(nextConfig) => updateNodeData(
            id,
            buildMultiAngleEditorDraft(data, nextConfig),
          )}
        />
  ), [config, data, id, sourceImage, t, updateNodeData])

  return (
    <ToolWorkbenchNodeFrame
      nodeId={id}
      title={data.displayName ?? t('node.multiAngleGeneration.title')}
      icon={<Camera className="h-4 w-4" />}
      selected={selected}
      width={width}
      height={height}
      hasSourceConnections={hasSourceConnections}
      onSelect={() => setSelectedNode(id)}
      onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      rightSlot={priceModel && <div className="flex items-center gap-2">
        <span className="max-w-36 truncate text-2xs text-text-muted">{getI18nText(priceModel.meta.name, i18n.language)}</span>
        <PriceEstimate providerId={priceModel.meta.provider} modelId={priceModel.meta.id} params={priceParams}
          requestCount={config.views.length} variant="badge" />
      </div>}
      dataAttributes={{
        'data-multi-angle-node-id': id,
        'data-multi-angle-profile': config.controlProfile,
      }}
      defaultWidth={720}
      defaultHeight={400}
      minWidth={640}
      minHeight={340}
    >
      {workbench}
    </ToolWorkbenchNodeFrame>
  )
})

MultiAngleGenerationNode.displayName = 'MultiAngleGenerationNode'
