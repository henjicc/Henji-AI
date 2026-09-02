import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  UiColorInput,
  UiFormRow,
  UiGroup,
  UiOptionButton,
  UiRangeInput,
  UiSelect,
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

const EXPENSIVE_EFFECT_PREVIEW_INTERVAL_MS = 80

function isExpensiveEffect(layer: ImageEditLayerV3): boolean {
  return layer.type === 'effect' && [
    'image.fast-blur-v3',
    'image.gaussian-blur-v2',
    'image.diffusion',
    'image.vgpu-glow',
  ].includes(layer.effectId)
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
  const previewTimeoutRef = useRef<number | null>(null)
  const lastPreviewAtRef = useRef<number | null>(null)

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
    if (previewTimeoutRef.current !== null) window.clearTimeout(previewTimeoutRef.current)
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
      previewTimeoutRef.current = null
      lastPreviewAtRef.current = typeof performance === 'undefined' ? Date.now() : performance.now()
      controller.setParameterPreview(previewId, layer.id, paramsFor(draftRef.current))
    }
    if (isExpensiveEffect(layer)) {
      if (previewTimeoutRef.current !== null) return
      const now = typeof performance === 'undefined' ? Date.now() : performance.now()
      const elapsed = lastPreviewAtRef.current === null
        ? EXPENSIVE_EFFECT_PREVIEW_INTERVAL_MS
        : now - lastPreviewAtRef.current
      if (elapsed >= EXPENSIVE_EFFECT_PREVIEW_INTERVAL_MS) publish()
      else {
        previewTimeoutRef.current = window.setTimeout(
          publish,
          EXPENSIVE_EFFECT_PREVIEW_INTERVAL_MS - elapsed,
        )
      }
      return
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
    if (previewTimeoutRef.current !== null) {
      window.clearTimeout(previewTimeoutRef.current)
      previewTimeoutRef.current = null
    }
    controller.setParameterPreview(previewId, layer.id, paramsFor(draftRef.current))
    controller.commitLayerParamsPreview(previewId, layer.id, paramsFor(draftRef.current))
  }

  return (
    <UiFormRow label={label}>
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
            if (previewTimeoutRef.current !== null) {
              window.clearTimeout(previewTimeoutRef.current)
              previewTimeoutRef.current = null
            }
            controller.clearParameterPreview(previewId)
            setDraft(value)
          }}
          onKeyUp={(event) => {
            if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') commit()
          }}
          onBlur={commit}
        />
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-text-muted">
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

  if (layer.type === 'effect'
    && (layer.effectId === 'image.fast-blur-v3' || layer.effectId === 'image.gaussian-blur-v2')) {
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
                className="justify-center text-xs"
                onClick={() => replaceParams(applyVgpuGlowLook(look))}
              >
                {t(`imageEditor.v3.parameters.glowLooks.${look}`)}
              </UiOptionButton>
            ))}
          </div>
        </UiGroup>
        <UiGroup title={t('imageEditor.v3.parameters.glowHalo')} titleTone="overline" divided gap="stack">
          <UiFormRow label={t('imageEditor.v3.parameters.tintEnabled')} inline>
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
            <UiFormRow
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
                    className="justify-center text-xs"
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
        <UiFormRow label={t('imageEditor.v3.parameters.curveChannel')}>
          <UiSelect
            aria-label={t('imageEditor.v3.parameters.curveChannel')}
            value={curveChannel}
            disabled={disabled}
            onChange={(event) => setCurveChannel(
              event.currentTarget.value as 'master' | 'red' | 'green' | 'blue',
            )}
          >
            {(['master', 'red', 'green', 'blue'] as const).map((channel) => (
              <option key={channel} value={channel}>
                {t(`imageEditor.v3.parameters.curveChannels.${channel}`)}
              </option>
            ))}
          </UiSelect>
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
