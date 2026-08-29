import { useMemo } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import { DerivedMediaParamControl } from '@/components/params/DerivedMediaParamControl'
import { UiButton, UiError } from '@/components/ui'
import { UiModal } from '@/components/ui/UiModal'
import { registry } from '@/core/ModelRegistry'
import {
  areStringListsEqual,
  collectInputMediaUrls,
} from '@/features/canvas/application/graphMediaResolver'
import { resolveElementEditMaskParam } from '@/features/canvas/capabilities/elementEditPolicy'
import { useCanvasStore } from '@/stores/canvasStore'

import type { CanvasSpecialEditorSurfaceProps } from './specialEditorRegistry'

function normalizeParams(value: DynamicValue): DynamicValueMap {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as DynamicValueMap
    : {}
}

function normalizeInlineImages(state: Readonly<DynamicValueMap>): string[] {
  const mediaInputs = state.mediaInputs && typeof state.mediaInputs === 'object'
    ? state.mediaInputs as DynamicValueMap
    : {}
  return Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : []
}

/**
 * 元素编辑只负责把画布会话接到唯一 DerivedMediaParamControl。
 * 遮罩画布、操作历史、PNG 导出和受管媒体导入仍全部由原模块负责。
 */
export default function ElementEditSpecialEditor({
  session,
  onDraftChange,
  onConfirm,
  onCancel,
}: CanvasSpecialEditorSurfaceProps): JSX.Element {
  const incomingImages = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaUrls(session.nodeId, state.nodes, state.edges, 'image'),
    areStringListsEqual,
  )
  const images = incomingImages.length > 0
    ? incomingImages
    : normalizeInlineImages(session.draftState)
  const sourceImage = images.length === 1 ? images[0] : null
  const modelId = typeof session.draftState.modelId === 'string'
    ? session.draftState.modelId
    : ''
  const model = registry.getModel(modelId)
  const maskParam = resolveElementEditMaskParam(model)
  const params = useMemo(
    () => normalizeParams(session.draftState.params),
    [session.draftState.params],
  )

  if (!sourceImage || !maskParam) {
    const message = !sourceImage
      ? '元素编辑必须且只能连接一张源图。'
      : '当前模型不支持受管 Alpha 遮罩，请切换到已核验的 GPT Image 2 编辑模型。'
    return (
      <UiModal
        isOpen
        title="元素编辑"
        size="compact"
        onClose={() => { onCancel() }}
        footer={(
          <UiButton type="button" variant="primary" size="sm" onClick={() => { onCancel() }}>
            返回画布
          </UiButton>
        )}
      >
        <UiError title="无法打开遮罩编辑器" message={message} />
      </UiModal>
    )
  }

  return (
    <DerivedMediaParamControl
      param={maskParam}
      value={params[maskParam.id]}
      allValues={{ ...params, images: [sourceImage] }}
      onChange={() => undefined}
      onParamChanges={(changes) => {
        onDraftChange({
          ...session.draftState,
          params: { ...params, ...changes },
        })
        onConfirm()
      }}
      editorOpen
      renderTrigger={false}
      onEditorDismiss={() => { onCancel() }}
    />
  )
}
