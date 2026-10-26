import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, SquareSplitHorizontal, Upload, Wand, X } from 'lucide-react'
import { ParamField, ParamList, UiButton, UiFormRow, UiGroup, UiError, UiCheckbox, UiIconButton, type ParamFieldSpec, type ParamGesture } from '@/components/ui'
import { builtinParameterFields, readBuiltinField, writeBuiltinField } from '@/components/ui/params/fieldSpec'
import { ColorGradeSections } from '@/components/colorGrade/ColorGradeSections'
import { ColorGradeScopes } from '@/components/colorGrade/ColorGradeScopes'
import { ColorGradeExportButton } from '@/components/colorGrade/ColorGradeExportButton'
import { notifyUser } from '@/contexts/NotificationContext'
import type { ColorGradeExportFormat, ColorGradeLutSize } from '@/core/imaging/lut/colorGradeExport'
import { chooseColorGradeExportPath, describeColorGradeExport } from '@/services/colorGradeExport'
import { openDialog } from '@/platform/desktopApi'
import type { CodeParameterValue, CodePoint } from '@/core/imaging/parameterTypes'
import type { ImagingParam } from '@/core/imaging/parameterDefinition'
import { COLOR_GRADE_PARAMETERS, parseImageColorGradeParams } from '@/core/imaging/adjustments/schema'
import { computeColorStatistics, type ColorStatistics } from '@/core/imaging/adjustments/colorStatistics'
import { LatestAdjustmentPreview } from '@/core/imaging/adjustments/latestPreview'
import type { ImageEditAdjustmentLayerV3, ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import { importImageEditorColorLutV3 } from '@/commands/imageEditorV3'
import { readImageEditColorPixelsV3, suggestImageEditColorV3 } from '../application/imageEditColorObservationV3'
import { readImageEditColorReferencePixelsV3 } from '../application/imageEditColorReferenceV3'
import { exportImageEditColorGradeV3 } from '../application/imageEditColorGradeExportV3'
import type { ImageEditorV3Controller } from './types'

const IMAGE_KEYS = new Set(COLOR_GRADE_PARAMETERS.map(param => param.key))
/** Image layers have no keyframes: numeric controls are sliders; section structure is shared with the video panel. */
function imageFields(params: readonly ImagingParam[]): ParamFieldSpec[] {
  return builtinParameterFields(params.filter(param => param.key !== 'hsl_show_mask' && IMAGE_KEYS.has(param.key))).map(field => ({ ...field, animatable: false, control: field.type === 'number' ? 'slider' as const : 'control' in field ? field.control : undefined })) as ParamFieldSpec[]
}

/** Image adapter owns layer transactions and resource choice; controls own neither workspace nor history. */
export function ImageEditorColorGradeParametersV3({ controller, layer, disabled }: { controller: Pick<ImageEditorV3Controller, 'sessionId' | 'setParameterPreview' | 'clearParameterPreview' | 'commitLayerParamsPreview' | 'document' | 'historyResourceDescriptors'>; layer: ImageEditAdjustmentLayerV3; disabled: boolean }): JSX.Element {
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
  const coalescer = useMemo(() => new LatestAdjustmentPreview<ImageEditJsonObjectV3>(callback => window.requestAnimationFrame(callback), handle => window.cancelAnimationFrame(handle), params => controllerRef.current.setParameterPreview(previewId, layer.id, observing.current ? { ...params, hsl_show_mask: true } : params)), [previewId, layer.id])
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
  const rowValues = { ...draft, ...Object.fromEntries(['shadow', 'midtone', 'highlight', 'global', 'hsl_grade'].flatMap(region => [`${region}_hue`, `${region}_strength`, `${region}_luminance`].map(key => [key, draft[key] ?? 0]))) }
  const renderRows = (params: readonly ImagingParam[]): JSX.Element | null => {
    const fields = imageFields(params)
    if (!fields.length) return null
    const values = Object.fromEntries(fields.map(field => [field.key, readBuiltinField(field, rowValues)]))
    return <ParamList fields={fields} values={values} contextKey={previewId}
      extras={Object.fromEntries(fields.map(field => [field.key, [disabled, field.key === 'hsl_invert' ? showMask : null, field.type === 'lut' ? [importing, names] : null]]))}
      resetDisabled={() => disabled} onReset={field => gesture(field).atomic(field.default)}
      renderControl={(field, value) => <UiGroup gap="row"><ParamField field={field} value={value} gesture={gesture(field)} disabled={disabled} resource={field.type === 'lut' ? <div className="flex flex-wrap items-center gap-1">
        <UiButton size="sm" disabled={disabled || importing} onClick={() => { void upload(field) }}><Upload  />{typeof value === 'string' && value ? names[value] ?? '更换查找表' : '导入 .cube'}</UiButton>
        {value && <UiButton size="sm" disabled={disabled} onClick={() => gesture(field).atomic('')}>移除</UiButton>}
      </div> : undefined} />{field.key === 'hsl_invert' && <UiCheckbox checked={showMask} disabled={disabled} aria-label="查看 HSL 选区" onCheckedChange={value => {
      observing.current = value; setShowMask(value)
      if (value) coalescer.update(latest.current)
      else { coalescer.cancel(); controllerRef.current.clearParameterPreview(previewId) }
    }}>查看 HSL 选区</UiCheckbox>}</UiGroup>}
    />
  }
  const resetParams = (params: readonly ImagingParam[]): void => {
    if (disabled) return
    const patch = Object.fromEntries(params.filter(param => IMAGE_KEYS.has(param.key) && param.key !== 'hsl_show_mask').map(param => [param.key, param.type === 'curve' ? [] : param.default]))
    latest.current = { ...latest.current, ...patch } as ImageEditJsonObjectV3; setDraft(latest.current)
    controllerRef.current.commitLayerParamsPreview(previewId, layer.id, latest.current)
  }
  const compare = (on: boolean): void => {
    if (disabled || active.current) return
    if (on) controllerRef.current.setParameterPreview(previewId, layer.id, parseImageColorGradeParams({}))
    else controllerRef.current.clearParameterPreview(previewId)
  }
  const [analyzing, setAnalyzing] = useState(false)
  const [reference, setReference] = useState<{ path: string; name: string } | null>(null)
  const chooseReference = async (): Promise<void> => {
    try {
      const selected = await openDialog({ multiple: false, filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif', 'tif', 'tiff'] }] })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (path && live.current) setReference({ path, name: path.split(/[\\/]/).at(-1) ?? path })
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const automatic = async (): Promise<void> => {
    if (disabled || analyzing || active.current) return
    const startParams = paramsRef.current
    setAnalyzing(true); setError('')
    try {
      const signal = new AbortController().signal
      const referencePixels = reference ? await readImageEditColorReferencePixelsV3({ kind: 'file', path: reference.path }, signal) : undefined
      const suggestion = await suggestImageEditColorV3(controllerRef.current.document, layer.id, controllerRef.current.historyResourceDescriptors ?? [], signal, undefined, referencePixels)
      if (!live.current || paramsRef.current !== startParams || disabledRef.current) return
      // A match starts from a neutral grade (same as the video shot match); automatic correction merges.
      latest.current = suggestion.apply === 'replace' ? parseImageColorGradeParams(suggestion.parameters) : { ...latest.current, ...suggestion.parameters }; setDraft(latest.current)
      controllerRef.current.commitLayerParamsPreview(previewId, layer.id, latest.current)
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (live.current) setAnalyzing(false) }
  }
  const [exporting, setExporting] = useState(false)
  const exportGrade = async (format: ColorGradeExportFormat, lutSize?: ColorGradeLutSize): Promise<void> => {
    if (exporting) return
    setError('')
    try {
      const path = await chooseColorGradeExportPath(format, layer.name); if (!path) return
      setExporting(true)
      // The save dialog already confirmed replacing an existing file.
      const result = await exportImageEditColorGradeV3(controllerRef.current.document, layer.id, { format, lutSize, path, overwrite: true })
      notifyUser(describeColorGradeExport(result))
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (live.current) setExporting(false) }
  }
  return <UiGroup gap="stack" titleTone="compact">
    {error && <UiError message={error} size="xs" align="start" />}
    <div className="flex flex-wrap items-center justify-end gap-1">
      <UiButton size="sm" loading={analyzing} disabled={disabled} disabledReason="当前图层不可编辑" tooltip={reference ? '让调整层下方的画面匹配参考图片的颜色，结果是可继续微调的滑块' : '分析调整层下方的画面，自动校正白平衡与曝光'} onClick={() => { void automatic() }}><Wand />{reference ? '匹配颜色' : '自动'}</UiButton>
      <UiIconButton size="xs" tooltip="按住查看调色前" aria-label="按住查看调色前" disabled={disabled} disabledReason="当前图层不可编辑"
        onPointerDown={() => compare(true)} onPointerUp={() => compare(false)} onPointerLeave={() => compare(false)} onPointerCancel={() => compare(false)}
        onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); compare(true) } }} onKeyUp={() => compare(false)} onBlur={() => compare(false)}><SquareSplitHorizontal /></UiIconButton>
      <ColorGradeExportButton busy={exporting} onExport={(format, lutSize) => { void exportGrade(format, lutSize) }} />
    </div>
    <UiFormRow label="校色参考" density="compact"><div className="flex min-w-0 items-center gap-1">
      <UiButton size="sm" className="min-w-0" disabled={disabled} disabledReason="当前图层不可编辑" tooltip={reference ? reference.path : '选另一张图片，让这张图的颜色向它靠拢'} onClick={() => { void chooseReference() }}><ImageIcon /><span className="truncate">{reference ? reference.name : '选择参考图片'}</span></UiButton>
      {reference && <UiIconButton size="xs" tooltip="不用参考，改回自动校色" aria-label="清除校色参考" onClick={() => setReference(null)}><X /></UiIconButton>}
    </div></UiFormRow>
    <ColorGradeSections host={{
      values: draft, disabled, renderRows, resetParams,
      previewParams: values => { if (disabled || active.current) return; if (values) controllerRef.current.setParameterPreview(previewId, layer.id, { ...latest.current, ...values }); else controllerRef.current.clearParameterPreview(previewId) },
      applyParams: values => { if (disabled) return; latest.current = { ...latest.current, ...values }; setDraft(latest.current); controllerRef.current.commitLayerParamsPreview(previewId, layer.id, latest.current) },
      renderLut: stage => renderRows(COLOR_GRADE_PARAMETERS.filter(param => param.key === `${stage}_lut`)),
      scopes: <ImageEditorColorScopesV3 document={controller.document} resources={controller.historyResourceDescriptors ?? []} />,
    }} />
  </UiGroup>
}

/** Same pixel reader and statistics as observe_image_edit_color, against the committed document. */
function ImageEditorColorScopesV3({ document, resources }: { document: ImageEditDocumentV3; resources: readonly ImageEditorV3ResourceDescriptor[] }): JSX.Element {
  const [statistics, setStatistics] = useState<ColorStatistics | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [manual, setManual] = useState(0)
  const latest = useRef({ document, resources }); latest.current = { document, resources }
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setBusy(true); setError('')
      readImageEditColorPixelsV3(latest.current.document, latest.current.resources, controller.signal)
        .then(sampled => { if (!controller.signal.aborted) setStatistics(computeColorStatistics(sampled.pixels, sampled.width, sampled.height, { scopes: true })) })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
        .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [document.revision, manual])
  return <ColorGradeScopes statistics={statistics} busy={busy} error={error} onRefresh={() => setManual(value => value + 1)} />
}
