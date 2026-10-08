import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { ParamField, ParamList, UiButton, UiGroup, UiError, UiCheckbox, type ParamFieldSpec, type ParamGesture } from '@/components/ui'
import { builtinParameterFields, readBuiltinField, writeBuiltinField } from '@/components/ui/params/fieldSpec'
import type { CodeParameterValue, CodePoint } from '@/core/imaging/parameterTypes'
import { COLOR_GRADE_PARAMETERS, parseImageColorGradeParams } from '@/core/imaging/adjustments/schema'
import { LatestAdjustmentPreview } from '@/core/imaging/adjustments/latestPreview'
import type { ImageEditAdjustmentLayerV3, ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes'
import { importImageEditorColorLutV3 } from '@/commands/imageEditorV3'
import type { ImageEditorV3Controller } from './types'

const GROUPS = ['基本校正', '创意', '曲线', 'LUT', '色轮', 'HSL 辅助', '晕影'] as const
const fields = builtinParameterFields(COLOR_GRADE_PARAMETERS.filter(param => param.key !== 'hsl_show_mask')).map(field => ({ ...field, animatable: false, control: field.type === 'number' ? 'slider' as const : 'control' in field ? field.control : undefined,
  group: field.key.startsWith('curve_') ? GROUPS[2] : field.type === 'lut' || field.key.includes('_lut_strength') ? GROUPS[3] : field.key.startsWith('hsl_') ? GROUPS[5] : field.key.startsWith('vignette_') ? GROUPS[6] : /^(shadow|midtone|highlight)_/.test(field.key) ? GROUPS[4] : /^(creative_|faded_|sharpen)/.test(field.key) ? GROUPS[1] : GROUPS[0],
})) as ParamFieldSpec[]

/** Image adapter owns layer transactions and resource choice; controls own neither workspace nor history. */
export function ImageEditorColorGradeParametersV3({ controller, layer, disabled }: { controller: Pick<ImageEditorV3Controller, 'sessionId' | 'setParameterPreview' | 'clearParameterPreview' | 'commitLayerParamsPreview'>; layer: ImageEditAdjustmentLayerV3; disabled: boolean }): JSX.Element {
  const id = useId()
  const previewId = `${controller.sessionId}:${layer.id}:color-grade:${id}`
  const currentPreviewId = useRef(previewId); currentPreviewId.current = previewId
  const [draft, setDraft] = useState<ImageEditJsonObjectV3>(() => parseImageColorGradeParams(layer.params))
  const latest = useRef(draft)
  const active = useRef(false)
  const live = useRef(true)
  const disabledRef = useRef(disabled); disabledRef.current = disabled
  const paramsRef = useRef(layer.params); paramsRef.current = layer.params
  const [showMask, setShowMask] = useState(false)
  const observing = useRef(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const controllerRef = useRef(controller); controllerRef.current = controller
  const coalescer = useMemo(() => new LatestAdjustmentPreview<ImageEditJsonObjectV3>(requestAnimationFrame, cancelAnimationFrame, params => controllerRef.current.setParameterPreview(previewId, layer.id, observing.current ? { ...params, hsl_show_mask: true } : params)), [previewId, layer.id])
  const cancel = useCallback((): void => { coalescer.cancel(); active.current = false; controllerRef.current.clearParameterPreview(previewId); observing.current = false; setShowMask(false); latest.current = parseImageColorGradeParams(paramsRef.current); setDraft(latest.current) }, [coalescer, previewId])
  useEffect(() => { if (!active.current) { latest.current = parseImageColorGradeParams(layer.params); setDraft(latest.current); if (observing.current) coalescer.update(latest.current) } }, [layer.params, controller, coalescer])
  useEffect(() => { live.current = true; setImporting(false); return () => { live.current = false; coalescer.cancel(); controllerRef.current.clearParameterPreview(previewId) } }, [coalescer, previewId])
  useEffect(() => { if (disabled) cancel() }, [disabled, cancel])
  const write = (field: ParamFieldSpec, value: CodeParameterValue): void => {
    if (disabled) return
    const patch = field.type === 'curve' ? { [field.key]: (value as CodePoint[]).map(point => ({ x: point.x * 100, y: point.y * 100 })) } : writeBuiltinField(field, value)
    latest.current = { ...latest.current, ...patch }
    setDraft(latest.current)
    coalescer.update(latest.current)
  }
  const finish = (): void => {
    if (disabled || !active.current) return
    coalescer.cancel(); active.current = false; observing.current = false; setShowMask(false)
    controllerRef.current.commitLayerParamsPreview(previewId, layer.id, latest.current)
  }
  const gesture = (field: ParamFieldSpec): ParamGesture => ({ begin: () => { if (!disabled) active.current = true }, active: () => active.current, write: value => { active.current = true; write(field, value) }, finish, cancel,
    atomic: value => { if (disabled) return; active.current = true; write(field, value); finish() } })
  const upload = async (field: ParamFieldSpec): Promise<void> => {
    if (disabled || importing) return
    const startParams = paramsRef.current
    setImporting(true); setError('')
    try { const asset = await importImageEditorColorLutV3(`${previewId}:lut`); if (asset && live.current && currentPreviewId.current === previewId && paramsRef.current === startParams && !disabledRef.current) { setNames(current => ({ ...current, [asset.resourceRef]: asset.name })); gesture(field).atomic(asset.resourceRef) } }
    catch (reason) { if (live.current && currentPreviewId.current === previewId) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (live.current && currentPreviewId.current === previewId) setImporting(false) }
  }
  const values = Object.fromEntries(fields.map(field => [field.key, readBuiltinField(field, { ...draft,
    ...Object.fromEntries(['shadow', 'midtone', 'highlight', 'hsl_grade'].flatMap(region => [`${region}_hue`, `${region}_strength`, `${region}_luminance`].map(key => [key, draft[key] ?? 0]))),
  })]))
  return <UiGroup gap="stack" titleTone="compact">
    {error && <UiError message={error} size="xs" align="start" />}
    <ParamList fields={fields} values={values} contextKey={previewId} initiallyOpenGroups={['基本校正']}
      extras={Object.fromEntries(fields.map(field => [field.key, [disabled, field.key === 'hsl_invert' ? showMask : null, field.type === 'lut' ? [importing, names] : null]]))}
      resetDisabled={() => disabled} onReset={field => gesture(field).atomic(field.default)}
      renderControl={(field, value) => <UiGroup gap="row"><ParamField field={field} value={value} gesture={gesture(field)} disabled={disabled} resource={field.type === 'lut' ? <div className="flex flex-wrap items-center gap-1">
        <UiButton size="sm" disabled={disabled || importing} onClick={() => { void upload(field) }}><Upload size={14} />{typeof value === 'string' && value ? names[value] ?? '更换查找表' : '导入 .cube'}</UiButton>
        {value && <UiButton size="sm" disabled={disabled} onClick={() => gesture(field).atomic('')}>移除</UiButton>}
      </div> : undefined} />{field.key === 'hsl_invert' && <UiCheckbox checked={showMask} disabled={disabled} aria-label="查看 HSL 选区" onCheckedChange={value => {
      observing.current = value; setShowMask(value)
      if (value) coalescer.update(latest.current)
      else { coalescer.cancel(); controllerRef.current.clearParameterPreview(previewId) }
    }}>查看 HSL 选区</UiCheckbox>}</UiGroup>}
    />
  </UiGroup>
}
