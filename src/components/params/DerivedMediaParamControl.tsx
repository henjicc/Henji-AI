import { useMemo, useState } from 'react'
import { Paintbrush, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiIconButton } from '@/components/ui'
import type { ImageUploadParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import {
  derivedMediaStateKey,
  resolveDerivedMediaSource,
} from '@/core/params/derivedMediaState'
import { createLogger } from '@/core/logging'
import {
  MaskEditorModal,
  parseMaskEditorDocument,
  type MaskEditorResult,
} from '@/features/maskEditor'
import { isUiInspectionReadOnly } from '@/platform/runtime'
import { importLocalMedia } from '@/services/localMediaImport'
import { dataUrlToFile } from '@/utils/imageConversion'
import { ParamLabel } from './ParamLabel'

const logger = createLogger('components.params.DerivedMediaParamControl')

interface DerivedMediaParamControlProps {
  param: ImageUploadParamDef
  value: DynamicValue
  allValues: DynamicValueMap
  onChange: (value: string[]) => void
  onParamChange?: (paramId: string, value: DynamicValue) => void
  onParamChanges?: (changes: DynamicValueMap) => void
  disabled?: boolean
  compact?: boolean
}

function normalizeMediaValue(value: DynamicValue): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }
  return typeof value === 'string' && value.trim().length > 0 ? [value.trim()] : []
}

/**
 * schema 声明的派生媒体入口。遮罩只从首张参考图现场创作，不提供第二次上传入口。
 */
export function DerivedMediaParamControl({
  param,
  value,
  allValues,
  onChange,
  onParamChange,
  onParamChanges,
  disabled = false,
  compact = false,
}: DerivedMediaParamControlProps): JSX.Element | null {
  const { i18n } = useTranslation()
  const [isEditorOpen, setEditorOpen] = useState(false)
  const values = normalizeMediaValue(value)
  const stateKey = derivedMediaStateKey(param.id)
  const sourceImage = resolveDerivedMediaSource(param, allValues)
  const initialDocument = useMemo(
    () => parseMaskEditorDocument(allValues[stateKey]),
    [allValues, stateKey]
  )
  const authoring = param.derivedMediaAuthoring

  if (!authoring) return null

  const hasMask = values.length > 0
  const actionText = getI18nText(
    hasMask ? authoring.actions.edit : authoring.actions.create,
    i18n.language
  )

  const applyChanges = (changes: DynamicValueMap): void => {
    if (onParamChanges) {
      onParamChanges(changes)
      return
    }
    for (const [paramId, nextValue] of Object.entries(changes)) {
      if (paramId === param.id) onChange(nextValue as string[])
      else onParamChange?.(paramId, nextValue)
    }
  }

  const handleConfirm = async (result: MaskEditorResult): Promise<void> => {
    const startedAt = performance.now()
    logger.info('派生遮罩保存开始', {
      event: 'derived_media.mask.persist.start',
      paramId: param.id,
      width: result.width,
      height: result.height,
    })
    try {
      let maskSource = result.maskDataUrl
      if (!isUiInspectionReadOnly()) {
        const file = await dataUrlToFile(result.maskDataUrl, `inpainting-mask-${Date.now()}.png`)
        const imported = await importLocalMedia(file, 'image')
        if (imported.kind !== 'image') throw new Error('遮罩导入结果不是图片')
        maskSource = imported.fullPath
      }
      applyChanges({
        [param.id]: [maskSource],
        [stateKey]: result.document,
      })
      setEditorOpen(false)
      logger.info('派生遮罩保存完成', {
        event: 'derived_media.mask.persist.completed',
        paramId: param.id,
        width: result.width,
        height: result.height,
        elapsedMs: Math.round(performance.now() - startedAt),
      })
    } catch (error) {
      logger.error('派生遮罩保存失败', {
        event: 'derived_media.mask.persist.failed',
        paramId: param.id,
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
      })
      throw error
    }
  }

  const action = (
    <div className={`flex items-center gap-1.5 ${compact ? 'nodrag nowheel' : ''}`}>
      <UiButton
        type="button"
        variant="muted"
        size="sm"
        className={compact ? '!h-7 gap-1.5 !rounded-md !px-2' : 'gap-1.5'}
        disabled={disabled || !sourceImage}
        onMouseDown={compact ? (event) => event.stopPropagation() : undefined}
        onClick={() => setEditorOpen(true)}
        data-derived-media-action={hasMask ? 'edit' : 'create'}
      >
        <Paintbrush className="h-3.5 w-3.5" />
        {actionText}
      </UiButton>
      {hasMask ? (
        <UiIconButton
          type="button"
          showBorder={false}
          appearance="hover-only"
          hoverVariant="danger"
          className="!h-7 !w-7"
          aria-label={i18n.language.startsWith('zh') ? '清除遮罩' : 'Clear mask'}
          title={i18n.language.startsWith('zh') ? '清除遮罩' : 'Clear mask'}
          disabled={disabled}
          onMouseDown={compact ? (event) => event.stopPropagation() : undefined}
          onClick={() => applyChanges({ [param.id]: [], [stateKey]: undefined })}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </UiIconButton>
      ) : null}
    </div>
  )

  return (
    <>
      {compact ? action : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <ParamLabel param={param} language={i18n.language} />
          {action}
        </div>
      )}
      {sourceImage ? (
        <MaskEditorModal
          isOpen={isEditorOpen}
          sourceImage={sourceImage}
          initialDocument={initialDocument}
          onCancel={() => setEditorOpen(false)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </>
  )
}
