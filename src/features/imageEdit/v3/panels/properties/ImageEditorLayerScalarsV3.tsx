import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { ParamField, ParamList, type ParamFieldSpec, type ParamGesture } from '@/components/ui'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditLayerCommonPatchV3 } from '@/core/imageEdit/v3/commandTypes'
import type { ImageEditorV3Controller } from '../../editor/types'

type Scalar = 'opacity' | 'fillOpacity' | 'density'
function field(key: Scalar, title: string): ParamFieldSpec {
  return { key, title, type: 'number', default: 100, min: 0, max: 100, step: 1, unit: '%', animatable: false, source: 'builtin', bindingKeys: [key] }
}


function ScalarControl({ controller, layer, spec, disabled }: { controller: ImageEditorV3Controller; layer: ImageEditLayerV3; spec: ParamFieldSpec; disabled: boolean }): JSX.Element {
  const key = spec.key as Scalar
  const value = key === 'density' ? layer.maskAttachment.density : layer[key]
  const [draft, setDraft] = useState(value * 100)
  const active = useRef(false), latest = useRef(value * 100)
  const port = useRef(controller); port.current = controller
  const previewId = `${controller.sessionId}:${layer.id}:${key}`
  const patch = (percent: number): ImageEditLayerCommonPatchV3 => key === 'density'
    ? { maskAttachment: { ...layer.maskAttachment, density: percent / 100 } } : { [key]: percent / 100 }
  useEffect(() => { if (!active.current) { setDraft(value * 100); latest.current = value * 100 } }, [value])
  useEffect(() => () => { active.current = false; port.current.clearParameterPreview(previewId) }, [previewId])
  useEffect(() => { if (disabled) { active.current = false; port.current.clearParameterPreview(previewId); setDraft(value * 100); latest.current = value * 100 } }, [disabled, previewId, value])
  const cancel = (): void => { active.current = false; controller.clearParameterPreview(previewId); setDraft(value * 100); latest.current = value * 100 }
  const gesture: ParamGesture = {
    begin: () => { if (!disabled) active.current = true }, active: () => active.current,
    write: next => { if (disabled || typeof next !== 'number') return; active.current = true; latest.current = next; setDraft(next); controller.setParameterPreview(previewId, layer.id, patch(next)) },
    finish: () => { if (!active.current || disabled) return; active.current = false; controller.commitLayerCommonPreview(previewId, layer.id, patch(latest.current)) },
    cancel,
    atomic: next => { if (!disabled && typeof next === 'number') controller.updateLayerCommon(layer.id, patch(next)) },
  }
  return <ParamField field={spec} value={draft} gesture={gesture} disabled={disabled} />
}

export function ImageEditorLayerScalarsV3({ controller, layer, disabled, mask = false }: { controller: ImageEditorV3Controller; layer: ImageEditLayerV3; disabled: boolean; mask?: boolean }): JSX.Element {
  const { t } = useTranslation('ui')
  const fields = mask ? [field('density', t('imageEditor.v3.workflow.density'))] : [field('opacity', t('imageEditor.v3.properties.opacity')), field('fillOpacity', t('imageEditor.v3.workflow.fill'))]
  return <ParamList fields={fields} contextKey={`${layer.id}:${mask}`}
    values={{ opacity: layer.opacity * 100, fillOpacity: layer.fillOpacity * 100, density: layer.maskAttachment.density * 100 }}
    renderControl={spec => <ScalarControl key={`${layer.id}:${spec.key}`} controller={controller} layer={layer} spec={spec} disabled={disabled} />} />
}
