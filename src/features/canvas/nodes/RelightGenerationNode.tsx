import { memo, useMemo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { SunMedium } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import { registry } from '@/core/ModelRegistry';

import { getI18nText } from '@/core/types';
import PriceEstimate from '@/components/ui/PriceEstimate';
import { RELIGHT_NODE_LAYOUT } from '@/features/canvas/domain/relightNodeLayout';
import { areMediaOutputListsEqual, collectInputMediaByKind } from '@/features/canvas/application/graphMediaResolver';



import { DEFAULT_RELIGHT_SETTINGS, normalizeRelightSettings, prepareRelightRoute, type RelightSettingsV1 } from '@/features/canvas/capabilities/relightPolicy';


import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';

import { MediaInputRow } from '@/features/canvas/params/MediaInputRow';



import { canvasViewStore, useCanvasStore } from '@/stores/canvasStore';


import { ToolWorkbenchNodeFrame } from './shared/ToolWorkbenchNodeFrame';
import { RelightWorkbench } from '@/features/canvas/ui/specialInterfaces/RelightSpecialEditor';
import { buildRelightEditorDraft } from '@/features/canvas/ui/specialInterfaces/relightEditorDraft';

import type { RelightGenerationNodeData } from '../application/specialGenerationNodeTypes';

type RelightGenerationNodeProps = NodeProps & {
  id: string
  data: RelightGenerationNodeData
  selected?: boolean
}

function readSettings(data: RelightGenerationNodeData): RelightSettingsV1 {
  try {
    return normalizeRelightSettings(data.relightSettings)
  } catch {
    return normalizeRelightSettings(DEFAULT_RELIGHT_SETTINGS)
  }
}

export const RelightGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: RelightGenerationNodeProps) => {
  const { t } = useTranslation()
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
  const settings = useMemo(() => readSettings(data), [data])
  const route = useMemo(() => prepareRelightRoute(
    settings,
    registry.getModelsByType('image'),
    data.params,
  ), [data.params, settings])
  const sourceInline = data.mediaInputs?.image ?? []
  const sourceImages = incomingSourceMedia.length > 0
    ? incomingSourceMedia.map((item) => item.url)
    : sourceInline.filter((item) => typeof item === 'string' && item.trim())

  const sourceImage = sourceImages[0] ?? null
  const layout = RELIGHT_NODE_LAYOUT[settings.lightingMode]
  const priceParams = useMemo(() => ({ ...route.params, images: sourceImage
    ? [sourceImage, ...(settings.lightingMode === 'smart' ? settings.smart.lightingReferenceImages : [])] : [] }),
  [route.params, settings.lightingMode, settings.smart.lightingReferenceImages, sourceImage])
  // Selection updates the frame only; retain the workbench instance and its local view state.
  const workbench = useMemo(() => (
        <RelightWorkbench
          settings={settings}
          sourceImage={sourceImage}
          embedded
          sourceControl={settings.lightingMode === 'manual' && !sourceImage ? (
            <MediaInputRow
              showHandle={false}
              nodeId={id}
              mediaKind="image"
              label={t('node.relightGeneration.sourceImage')}
              maxCount={1}
              inlineValue={data.mediaInputs?.image ?? []}
              onInlineChange={(images) => updateNodeData(id, {
                mediaInputs: { ...(data.mediaInputs ?? {}), image: images },
              })}
            />
          ) : undefined}
          onSettingsChange={(nextSettings) => updateNodeData(
            id,
            buildRelightEditorDraft(data, nextSettings),
          )}
        />
  ), [data, id, settings, sourceImage, t, updateNodeData])

  return (
    <ToolWorkbenchNodeFrame
      nodeId={id}
      title={data.displayName ?? t('node.menu.relightGeneration')}
      icon={<SunMedium className="h-4 w-4" />}
      selected={selected}
      width={width}
      defaultWidth={layout.width}
      minWidth={layout.minWidth}
      height={height}
      defaultHeight={layout.height}
      minHeight={layout.minHeight}
      hasSourceConnections={hasSourceConnections}
      onSelect={() => setSelectedNode(id)}
      onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      rightSlot={route.model && <div className="flex items-center gap-2">
        <span className="max-w-36 truncate text-2xs text-text-muted">{getI18nText(route.model.meta.name, 'zh-CN')}</span>
        <PriceEstimate providerId={route.model.meta.provider} modelId={route.model.meta.id} params={priceParams} variant="badge" />
      </div>}
      dataAttributes={{
        'data-relight-node-id': id,
        'data-relight-mode': settings.lightingMode,
      }}
    >
      {workbench}
    </ToolWorkbenchNodeFrame>
  )
})

RelightGenerationNode.displayName = 'RelightGenerationNode'
