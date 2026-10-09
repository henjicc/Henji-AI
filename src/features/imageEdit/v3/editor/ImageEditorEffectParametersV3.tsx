import { ParamField, ParamList, type ParamGesture, type ParamFieldSpec } from '@/components/ui'
import { builtinParameterFields, readBuiltinField, writeBuiltinField } from '@/components/ui/params/fieldSpec'
import { listImagingEffects, type RegisteredImagingEffect } from '@/core/imaging/effects/registry'
import type { ImageEditEffectLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { ImageEditorColorGradeParametersV3 } from './ImageEditorColorGradeParametersV3'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  UiColorInput,
  UiFormRow,
  UiGroup,
  UiOptionButton,
  UiRangeInput,
  Dropdown,
  UiSwitch,
} from '@/components/ui'
import {
  applyVgpuGlowLook,
  createDefaultVgpuGlowOperationParams,
  replaceVgpuGlowChromaticChannel,
  type VgpuGlowChromaticChannel,
  type VgpuGlowLook,
  type VgpuGlowOperationParams,
} from '@/core/imageEdit'
import type { ImageEditJsonObjectV3, ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3Controller } from './types'

interface ParameterSliderProps {
  controller: ImageEditorV3Controller
  layer: ImageEditLayerV3
  label: string
  parameterKey: string
  value: number
  min: number
  max: number
  step?: number
  disabled: boolean
  createParams?: (value: number) => ImageEditJsonObjectV3
}

function ParameterSlider({
  controller,
  layer,
  label,
  parameterKey,
  value,
  min,
  max,
  step = 0.01,
  disabled,
  createParams,
}: ParameterSliderProps): JSX.Element {
  const reactId = useId().replace(/:/g, '')
  const previewId = `${controller.sessionId}:${layer.id}:${parameterKey}:${reactId}`
  const [draft, setDraft] = useState(value)
  const activeRef = useRef(false)
  const draftRef = useRef(value)
  const previewFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!activeRef.current) {
      setDraft(value)
      draftRef.current = value
    }
  }, [value])

  useEffect(() => () => {
    if (previewFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(previewFrameRef.current)
    }
    controller.clearParameterPreview(previewId)
  }, [controller, previewId])
  useEffect(() => {
    if (!disabled || !activeRef.current) return
    activeRef.current = false
    controller.clearParameterPreview(previewId)
    setDraft(value)
    draftRef.current = value
  }, [controller, disabled, previewId, value])

  const paramsFor = (next: number): ImageEditJsonObjectV3 => {
    if (createParams) return createParams(next)
    if (layer.type !== 'effect' && layer.type !== 'adjustment') return {}
    return { ...layer.params, [parameterKey]: next }
  }

  const update = (next: number): void => {
    if (disabled) return
    activeRef.current = true
    draftRef.current = next
    setDraft(next)
    const publish = (): void => {
      previewFrameRef.current = null
      controller.setParameterPreview(previewId, layer.id, paramsFor(draftRef.current))
    }
    if (previewFrameRef.current !== null) return
    if (typeof requestAnimationFrame === 'function') {
      previewFrameRef.current = requestAnimationFrame(publish)
    } else {
      publish()
    }
  }

  const commit = (): void => {
    if (disabled || !activeRef.current) return
    activeRef.current = false
    if (previewFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(previewFrameRef.current)
      previewFrameRef.current = null
    }
    controller.setParameterPreview(previewId, layer.id, paramsFor(draftRef.current))
    controller.commitLayerParamsPreview(previewId, layer.id, paramsFor(draftRef.current))
  }

  return (
    <UiFormRow density="compact" label={label}>
      <div className="flex items-center gap-2">
        <UiRangeInput
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          onChange={(event) => update(Number(event.currentTarget.value))}
          onPointerUp={commit}
          onPointerCancel={() => {
            activeRef.current = false
            if (previewFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
              cancelAnimationFrame(previewFrameRef.current)
              previewFrameRef.current = null
            }
            controller.clearParameterPreview(previewId)
            setDraft(value)
          }}
          onKeyUp={(event) => {
            if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') commit()
          }}
          onBlur={commit}
        />
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-text2">
          {draft.toFixed(2)}
        </span>
      </div>
    </UiFormRow>
  )
}

function readNumber(params: ImageEditJsonObjectV3, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function layerParams(layer: ImageEditLayerV3): ImageEditJsonObjectV3 | null {
  return layer.type === 'effect' || layer.type === 'adjustment' ? layer.params : null
}

function toJsonObject(value: object): ImageEditJsonObjectV3 {
  return JSON.parse(JSON.stringify(value)) as ImageEditJsonObjectV3
}

function readGlowParams(params: ImageEditJsonObjectV3): VgpuGlowOperationParams {
  const defaults = createDefaultVgpuGlowOperationParams()
  const look = params.look === 'natural' || params.look === 'dreamy' || params.look === 'neon'
    ? params.look
    : defaults.look
  const channels = Array.isArray(params.chromaticChannels)
    && params.chromaticChannels.length === 2
    && ['red', 'green', 'blue'].includes(String(params.chromaticChannels[0]))
    && ['red', 'green', 'blue'].includes(String(params.chromaticChannels[1]))
    && params.chromaticChannels[0] !== params.chromaticChannels[1]
    ? params.chromaticChannels as unknown as readonly [VgpuGlowChromaticChannel, VgpuGlowChromaticChannel]
    : defaults.chromaticChannels
  return {
    schemaVersion: 4,
    look,
    tintEnabled: typeof params.tintEnabled === 'boolean' ? params.tintEnabled : defaults.tintEnabled,
    tintColor: typeof params.tintColor === 'string' && /^#[0-9a-f]{6}$/i.test(params.tintColor)
      ? params.tintColor
      : defaults.tintColor,
    intensity: readNumber(params, 'intensity', defaults.intensity),
    radius: readNumber(params, 'radius', defaults.radius),
    chromaticAberration: readNumber(params, 'chromaticAberration', defaults.chromaticAberration),
    chromaticChannels: channels,
    sourceThreshold: readNumber(params, 'sourceThreshold', defaults.sourceThreshold),
    whiteHeat: readNumber(params, 'whiteHeat', defaults.whiteHeat),
  }
}

export function ImageEditorEffectParametersV3({
  controller,
  layer,
  disabled,
}: {
  controller: ImageEditorV3Controller
  layer: ImageEditLayerV3
  disabled: boolean
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const [curveChannel, setCurveChannel] = useState<'master' | 'red' | 'green' | 'blue'>('master')
  const params = layerParams(layer)
  if (!params) return null
  const sliders: Array<[string, number, number, number, number]> = []
  const shared = layer.type === 'effect' ? listImagingEffects().find(effect => effect.id === layer.effectId && effect.hosts.includes('image')) : undefined
  if (shared && layer.type === 'effect') return <SharedEffectParameters controller={controller} layer={layer} descriptor={shared} disabled={disabled} />

  if (layer.type === 'effect'
    && layer.effectId === 'image.fast-blur-v3') {
    sliders.push(['radius', readNumber(params, 'radius', 12), 0, 1000, 0.5])
  } else if (layer.type === 'effect' && layer.effectId === 'image.diffusion') {
    for (const key of ['strength', 'glowRange', 'highlightResponse', 'softness'] as const) {
      sliders.push([key, readNumber(params, key, 0.5), 0, 1, 0.01])
    }
  } else if (layer.type === 'adjustment' && layer.adjustmentId === 'exposure') {
    sliders.push(
      ['stops', readNumber(params, 'stops', 0), -8, 8, 0.05],
      ['offset', readNumber(params, 'offset', 0), -1, 1, 0.01],
      ['gamma', readNumber(params, 'gamma', 1), 0.1, 4, 0.01],
    )
  } else if (layer.type === 'adjustment' && layer.adjustmentId === 'temperature-tint') {
    sliders.push(
      ['temperature', readNumber(params, 'temperature', 0), -1, 1, 0.01],
      ['tint', readNumber(params, 'tint', 0), -1, 1, 0.01],
    )
  } else if (layer.type === 'adjustment' && layer.adjustmentId === 'hsl') {
    sliders.push(
      ['hueDegrees', readNumber(params, 'hueDegrees', 0), -180, 180, 1],
      ['saturation', readNumber(params, 'saturation', 0), -1, 1, 0.01],
      ['lightness', readNumber(params, 'lightness', 0), -1, 1, 0.01],
    )
  }

  if (layer.type === 'effect' && layer.effectId === 'image.vgpu-glow') {
    const glow = readGlowParams(params)
    const replaceParams = (next: VgpuGlowOperationParams): void => {
      if (!disabled) controller.updateLayerParams(layer.id, toJsonObject(next))
    }
    const slider = (key: 'intensity' | 'radius' | 'chromaticAberration' | 'sourceThreshold' | 'whiteHeat') => (
      <ParameterSlider
        key={key}
        controller={controller}
        layer={layer}
        label={t(`imageEditor.v3.parameters.${key}`)}
        parameterKey={key}
        value={glow[key]}
        min={0}
        max={1}
        step={0.01}
        disabled={disabled}
        createParams={(next) => toJsonObject({ ...glow, [key]: next })}
      />
    )
    const looks: readonly VgpuGlowLook[] = ['natural', 'dreamy', 'neon']
    const channelOptions: readonly VgpuGlowChromaticChannel[] = ['red', 'green', 'blue']
    return (
      <div className="space-y-5" data-effect-parameters="image.vgpu-glow">
        <UiGroup title={t('imageEditor.v3.parameters.glowLook')} titleTone="overline" gap="row">
          <div className="grid grid-cols-3 gap-1">
            {looks.map((look) => (
              <UiOptionButton
                key={look}
                type="button"
                variant="menu"
                active={glow.look === look}
                disabled={disabled}
                size="sm" className="justify-center"
                onClick={() => replaceParams(applyVgpuGlowLook(look))}
              >
                {t(`imageEditor.v3.parameters.glowLooks.${look}`)}
              </UiOptionButton>
            ))}
          </div>
        </UiGroup>
        <UiGroup title={t('imageEditor.v3.parameters.glowHalo')} titleTone="overline" divided gap="stack">
          <UiFormRow density="compact" label={t('imageEditor.v3.parameters.tintEnabled')} inline>
            <div className="flex items-center gap-2">
              <UiSwitch
                checked={glow.tintEnabled}
                disabled={disabled}
                aria-label={t('imageEditor.v3.parameters.tintEnabled')}
                onCheckedChange={(tintEnabled) => replaceParams({ ...glow, tintEnabled })}
              />
              <UiColorInput
                value={glow.tintColor}
                disabled={disabled || !glow.tintEnabled}
                aria-label={t('imageEditor.v3.parameters.tintColor')}
                onChange={(event) => replaceParams({ ...glow, tintColor: event.currentTarget.value })}
              />
            </div>
          </UiFormRow>
          {slider('radius')}
          {slider('intensity')}
          {slider('chromaticAberration')}
          {([0, 1] as const).map((index) => (
            <UiFormRow density="compact"
              key={index}
              label={t(`imageEditor.v3.parameters.chromaticSide${index === 0 ? 'Left' : 'Right'}`)}
            >
              <div className="grid grid-cols-3 gap-1">
                {channelOptions.map((channel) => (
                  <UiOptionButton
                    key={channel}
                    type="button"
                    variant="menu"
                    active={glow.chromaticChannels[index] === channel}
                    disabled={disabled}
                    size="sm" className="justify-center"
                    onClick={() => replaceParams({
                      ...glow,
                      chromaticChannels: replaceVgpuGlowChromaticChannel(
                        glow.chromaticChannels,
                        index,
                        channel,
                      ),
                    })}
                  >
                    {t(`imageEditor.v3.parameters.channels.${channel}`)}
                  </UiOptionButton>
                ))}
              </div>
            </UiFormRow>
          ))}
        </UiGroup>
        <UiGroup title={t('imageEditor.v3.parameters.glowSource')} titleTone="overline" divided gap="stack">
          {slider('sourceThreshold')}
          {slider('whiteHeat')}
        </UiGroup>
      </div>
    )
  }

  if (layer.type === 'adjustment' && layer.adjustmentId === 'color_grade') return <ImageEditorColorGradeParametersV3 key={`${controller.sessionId}:${layer.id}`} controller={controller} layer={layer} disabled={disabled} />

  if (layer.type === 'adjustment' && layer.adjustmentId === 'curves') {
    const points = Array.isArray(params[curveChannel]) ? params[curveChannel] : []
    const black = points[0]
    const white = points[points.length - 1]
    const blackY = typeof black === 'object' && black && !Array.isArray(black)
      && typeof black.y === 'number' ? black.y : 0
    const whiteY = typeof white === 'object' && white && !Array.isArray(white)
      && typeof white.y === 'number' ? white.y : 1
    const curveParams = (index: number, next: number): ImageEditJsonObjectV3 => ({
      ...params,
      [curveChannel]: points.map((point, pointIndex) => (
        pointIndex === index && typeof point === 'object' && point && !Array.isArray(point)
          ? { ...point, y: next }
          : point
      )),
    })
    return (
      <>
        <UiFormRow density="compact" label={t('imageEditor.v3.parameters.curveChannel')}>
          <Dropdown<'master' | 'red' | 'green' | 'blue'>
            ariaLabel={t('imageEditor.v3.parameters.curveChannel')}
            className="w-full"
            minWidthStrategy="none"
            value={curveChannel}
            disabled={disabled}
            display={t(`imageEditor.v3.parameters.curveChannels.${curveChannel}`)}
            options={(['master', 'red', 'green', 'blue'] as const).map((channel) => ({
              label: t(`imageEditor.v3.parameters.curveChannels.${channel}`),
              value: channel,
            }))}
            onSelect={setCurveChannel}
          />
        </UiFormRow>
        <ParameterSlider
          controller={controller}
          layer={layer}
          label={t('imageEditor.v3.parameters.curveBlack')}
          parameterKey={`curve-${curveChannel}-black`}
          value={blackY}
          min={0}
          max={1}
          disabled={disabled}
          createParams={(next) => curveParams(0, next)}
        />
        <ParameterSlider
          controller={controller}
          layer={layer}
          label={t('imageEditor.v3.parameters.curveWhite')}
          parameterKey={`curve-${curveChannel}-white`}
          value={whiteY}
          min={0}
          max={1}
          disabled={disabled}
          createParams={(next) => curveParams(Math.max(0, points.length - 1), next)}
        />
      </>
    )
  }

  return (
    <>
      {sliders.map(([key, current, min, max, step]) => (
        <ParameterSlider
          key={key}
          controller={controller}
          layer={layer}
          label={t(`imageEditor.v3.parameters.${key}`)}
          parameterKey={key}
          value={current}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
      ))}
    </>
  )
}

/** 共享描述只投影既有控件与事务；不引入第二份 Gaussian 字段表。 */
function SharedEffectParameters({ controller, layer, descriptor, disabled }: {
  controller: ImageEditorV3Controller; layer: ImageEditEffectLayerV3; descriptor: RegisteredImagingEffect; disabled: boolean;
}): JSX.Element {
  const id = useId()
  const previewId = `${controller.sessionId}:${layer.id}:${id}`
  const [draft, setDraft] = useState(layer.params)
  const latest = useRef(layer.params)
  const active = useRef(false)
  const frame = useRef<number | null>(null)
  const cancelFrame = (): void => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null }
  useEffect(() => { if (!active.current) { latest.current = layer.params; setDraft(layer.params) } }, [layer.params])
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); controller.clearParameterPreview(previewId) }, [controller, previewId])
  const fields = builtinParameterFields(descriptor.parameters).map(field => ({ ...field, animatable: false as const }))
  const cancel = (): void => { cancelFrame(); active.current = false; controller.clearParameterPreview(previewId); latest.current = layer.params; setDraft(layer.params) }
  useEffect(() => { if (disabled) cancel() }, [disabled]) // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (): void => {
    if (disabled || !active.current) return
    cancelFrame(); active.current = false; controller.commitLayerParamsPreview(previewId, layer.id, latest.current)
  }
  const gesture = (field: ParamFieldSpec): ParamGesture => ({
    begin: () => { if (!disabled) active.current = true }, active: () => active.current,
    write: value => {
      if (disabled) return
      active.current = true
      latest.current = { ...latest.current, ...writeBuiltinField(field, value) }; setDraft(latest.current)
      if (frame.current === null) frame.current = requestAnimationFrame(() => {
        frame.current = null; controller.setParameterPreview(previewId, layer.id, latest.current)
      })
    }, finish, cancel,
    atomic: value => { if (disabled) return; active.current = true; latest.current = { ...latest.current, ...writeBuiltinField(field, value) }; setDraft(latest.current); finish() },
  })
  return <ParamList fields={fields} values={Object.fromEntries(fields.map(field => [field.key, readBuiltinField(field, draft)]))}
    contextKey={previewId} extras={Object.fromEntries(fields.map(field => [field.key, disabled]))}
    renderControl={(field, value) => <ParamField field={field} value={value} gesture={gesture(field)} disabled={disabled} />}
  />
}
