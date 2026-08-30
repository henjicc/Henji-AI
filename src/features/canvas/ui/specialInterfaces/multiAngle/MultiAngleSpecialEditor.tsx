import { useMemo, useState, type ReactNode } from 'react'
import { Aperture, Camera, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  UiButton,
  UiIconButton,
  UiModal,
  UiOptionButton,
  UiRangeInput,
  UiSwitch,
} from '@/components/ui'
import {
  UI_GLASS_ADAPTIVE_REGION_CLASS,
  UI_GLASS_ADAPTIVE_SURFACE_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
} from '@/components/ui/styleTokens'
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData'
import {
  MULTI_ANGLE_CONTINUOUS_PRESETS,
  MULTI_ANGLE_DISCRETE_VIEW_PRESETS,
  MULTI_ANGLE_FLUX_PRESETS,
  MULTI_ANGLE_MAX_VIEW_COUNT,
  createDefaultMultiAngleConfig,
  normalizeMultiAngleConfig,
  type MultiAngleConfigV1,
  type MultiAngleContinuousViewV1,
  type MultiAngleControlProfile,
  type MultiAngleDiscretePreset,
  type MultiAngleFluxViewV1,
  type MultiAngleViewV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import type { CanvasSpecialEditorSurfaceProps } from '../specialEditorRegistry'
import { buildMultiAngleEditorDraft } from './multiAngleEditorState'
import { MultiAngleOrbitPreview } from './MultiAngleOrbitPreview'
import {
  describeLocalizedMultiAngleCamera,
  describeLocalizedMultiAngleProximity,
  describeLocalizedMultiAngleVertical,
  translateMultiAngleViewLabel,
} from './multiAngleLocalization'

function sourceImageFromState(state: Readonly<DynamicValueMap>): string | null {
  if (typeof state.sourceImageUrl === 'string' && state.sourceImageUrl.trim()) return state.sourceImageUrl
  const mediaInputs = state.mediaInputs && typeof state.mediaInputs === 'object'
    ? state.mediaInputs as DynamicValueMap
    : {}
  const images = Array.isArray(mediaInputs.image) ? mediaInputs.image : []
  return images.find((item): item is string => typeof item === 'string' && item.trim().length > 0) ?? null
}

function readConfig(state: Readonly<DynamicValueMap>): MultiAngleConfigV1 {
  try {
    return normalizeMultiAngleConfig(state.multiAngleConfig)
  } catch {
    return createDefaultMultiAngleConfig()
  }
}

function switchProfile(profile: MultiAngleControlProfile): MultiAngleConfigV1 {
  return createDefaultMultiAngleConfig(profile)
}

function replaceView(config: MultiAngleConfigV1, next: MultiAngleViewV1): MultiAngleConfigV1 {
  return {
    ...config,
    views: config.views.map((view) => view.viewId === next.viewId ? next : view),
  }
}

function nextUnusedView(config: MultiAngleConfigV1): MultiAngleViewV1 | null {
  const presets = config.controlProfile === 'continuous-v1'
    ? MULTI_ANGLE_CONTINUOUS_PRESETS
    : config.controlProfile === 'discrete-v1'
      ? MULTI_ANGLE_DISCRETE_VIEW_PRESETS
      : MULTI_ANGLE_FLUX_PRESETS
  const used = new Set(config.views.map((view) => view.viewId))
  const preset = presets.find((item) => !used.has(item.view.viewId))
  return preset ? { ...preset.view } : null
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  valueText,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  valueText?: string
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-3">
        <span className={UI_TEXT_LABEL_CLASS}>{label}</span>
        <span className={UI_TEXT_META_CLASS}>{valueText ?? `${value}${suffix}`}</span>
      </span>
      <UiRangeInput
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

interface MultiAngleWorkbenchProps {
  config: MultiAngleConfigV1
  sourceImage: string | null
  onConfigChange: (config: MultiAngleConfigV1) => void
  sourceControl?: ReactNode
  embedded?: boolean
}

export function MultiAngleWorkbench({
  config,
  sourceImage,
  onConfigChange,
  sourceControl,
  embedded = false,
}: MultiAngleWorkbenchProps): JSX.Element {
  const { t } = useTranslation()
  const [selectedViewId, setSelectedViewId] = useState(config.views[0]?.viewId ?? '')
  const selected = config.views.find((view) => view.viewId === selectedViewId) ?? config.views[0]

  const updateConfig = (next: MultiAngleConfigV1): void => {
    const normalized = normalizeMultiAngleConfig(next)
    onConfigChange(normalized)
    if (!normalized.views.some((view) => view.viewId === selectedViewId)) {
      setSelectedViewId(normalized.views[0]?.viewId ?? '')
    }
  }
  const selectProfile = (profile: MultiAngleControlProfile): void => {
    const next = switchProfile(profile)
    setSelectedViewId(next.views[0]?.viewId ?? '')
    updateConfig(next)
  }
  const addView = (): void => {
    const next = nextUnusedView(config)
    if (!next || config.views.length >= MULTI_ANGLE_MAX_VIEW_COUNT) return
    updateConfig({ ...config, views: [...config.views, next] })
    setSelectedViewId(next.viewId)
  }
  const removeSelected = (): void => {
    if (!selected || config.views.length <= 1) return
    const views = config.views.filter((view) => view.viewId !== selected.viewId)
    setSelectedViewId(views[0].viewId)
    updateConfig({ ...config, views })
  }
  const patchContinuous = (patch: Partial<MultiAngleContinuousViewV1>): void => {
    if (!selected || selected.kind !== 'continuous') return
    const index = Math.max(config.views.findIndex((view) => view.viewId === selected.viewId), 0)
    updateConfig(replaceView(config, {
      ...selected,
      ...patch,
      presetId: 'custom',
      label: t('node.multiAngleEditor.customView', { index: index + 1 }),
    }))
  }
  const chooseDiscretePreset = (preset: MultiAngleDiscretePreset): void => {
    if (!selected || selected.kind !== 'discrete') return
    const existing = config.views.find((view) => view.kind === 'discrete' && view.preset === preset)
    if (existing) {
      setSelectedViewId(existing.viewId)
      return
    }
    const definition = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.find((item) => item.view.preset === preset)
    if (!definition) return
    const next = { ...definition.view }
    updateConfig({
      ...config,
      views: config.views.map((view) => view.viewId === selected.viewId ? next : view),
    })
    setSelectedViewId(next.viewId)
  }
  const patchFlux = (patch: Partial<MultiAngleFluxViewV1>): void => {
    if (!selected || selected.kind !== 'flux') return
    const index = Math.max(config.views.findIndex((view) => view.viewId === selected.viewId), 0)
    updateConfig(replaceView(config, {
      ...selected,
      ...patch,
      presetId: 'custom',
      label: t('node.multiAngleEditor.customFluxView', { index: index + 1 }),
    }))
  }
  return (
      <div
        data-multi-angle-workbench="true"
        className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1.3fr)_minmax(250px,0.7fr)]"
      >
        <div className={`flex min-h-0 items-center justify-center ${embedded ? 'p-2' : 'p-4'}`}>
          <div className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl ${embedded ? 'bg-bg-dark/45' : `border border-veil-subtle ${UI_GLASS_ADAPTIVE_SURFACE_CLASS}`}`}>
            {sourceImage ? (
              <img src={resolveImageDisplayUrl(sourceImage)} alt={t('node.multiAngleEditor.sourceAlt')} className="max-h-[76%] max-w-[76%] object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-muted">
                <Camera className="h-8 w-8" />
                <p className="text-sm">{t('node.multiAngleEditor.sourceRequired')}</p>
              </div>
            )}
            <MultiAngleOrbitPreview
              views={config.views}
              selectedViewId={selected?.viewId ?? ''}
              onContinuousChange={patchContinuous}
              onDiscretePresetChange={chooseDiscretePreset}
              onFluxChange={patchFlux}
            />
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-sticky rounded-lg bg-overlay px-3 py-2">
              <p className="truncate text-xs font-medium text-text">{selected
                ? describeLocalizedMultiAngleCamera(
                    t,
                    selected,
                    Math.max(config.views.findIndex((view) => view.viewId === selected.viewId), 0),
                  )
                : t('node.multiAngleEditor.noSelection')}</p>
              <p className="mt-0.5 text-3xs text-text-muted">{selected?.kind === 'continuous'
                ? t('node.multiAngleEditor.hints.continuous')
                : selected?.kind === 'flux'
                  ? t('node.multiAngleEditor.hints.flux')
                  : t('node.multiAngleEditor.hints.discrete')}</p>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-sticky rounded-lg bg-overlay px-3 py-2 text-xs text-text-soft">
              {t('node.multiAngleEditor.disclaimer')}
            </div>
          </div>
        </div>

        <div className={`min-h-0 overflow-y-auto border-l border-veil-subtle ${embedded ? 'p-3' : `p-4 ${UI_GLASS_ADAPTIVE_REGION_CLASS}`}`}>
          {sourceControl ? <div className="mb-3">{sourceControl}</div> : null}
          <section className="space-y-3">
            <h3 className={UI_TEXT_SECTION_CLASS}>{t('node.multiAngleEditor.controlMode')}</h3>
            <div className="grid grid-cols-3 gap-2">
              <UiOptionButton
                type="button"
                variant="flat"
                active={config.controlProfile === 'continuous-v1'}
                onClick={() => selectProfile('continuous-v1')}
              >
                <span className="flex flex-col"><span className="text-sm font-medium">{t('node.multiAngleEditor.profiles.continuous.title')}</span><span className="text-xs text-text-soft">{t('node.multiAngleEditor.profiles.continuous.subtitle')}</span></span>
              </UiOptionButton>
              <UiOptionButton
                type="button"
                variant="flat"
                active={config.controlProfile === 'flux-native-v1'}
                onClick={() => selectProfile('flux-native-v1')}
              >
                <span className="flex flex-col"><span className="text-sm font-medium">{t('node.multiAngleEditor.profiles.flux.title')}</span><span className="text-xs text-text-soft">{t('node.multiAngleEditor.profiles.flux.subtitle')}</span></span>
              </UiOptionButton>
              <UiOptionButton
                type="button"
                variant="flat"
                active={config.controlProfile === 'discrete-v1'}
                onClick={() => selectProfile('discrete-v1')}
              >
                <span className="flex flex-col"><span className="text-sm font-medium">{t('node.multiAngleEditor.profiles.discrete.title')}</span><span className="text-xs text-text-soft">{t('node.multiAngleEditor.profiles.discrete.subtitle')}</span></span>
              </UiOptionButton>
            </div>
          </section>

          <section className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className={UI_TEXT_SECTION_CLASS}>{t('node.multiAngleEditor.outputViews', { count: config.views.length, max: MULTI_ANGLE_MAX_VIEW_COUNT })}</h3>
              <div className="flex items-center gap-1">
                <UiIconButton type="button" appearance="hover-only" showBorder={false} aria-label={t('node.multiAngleEditor.removeView')} disabled={config.views.length <= 1} onClick={removeSelected}>
                  <Trash2 className="h-4 w-4" />
                </UiIconButton>
                <UiIconButton type="button" appearance="hover-only" showBorder={false} aria-label={t('node.multiAngleEditor.addView')} disabled={!nextUnusedView(config)} onClick={addView}>
                  <Plus className="h-4 w-4" />
                </UiIconButton>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {config.views.map((view, index) => (
                <UiOptionButton
                  key={view.viewId}
                  type="button"
                  variant="flat"
                  active={view.viewId === selected?.viewId}
                  onClick={() => setSelectedViewId(view.viewId)}
                >
                  <span className="truncate text-xs">{index + 1}. {translateMultiAngleViewLabel(t, view, index)}</span>
                </UiOptionButton>
              ))}
            </div>
          </section>

          {selected?.kind === 'continuous' ? (
            <section className="mt-5 space-y-4">
              <h3 className={UI_TEXT_SECTION_CLASS}>{t('node.multiAngleEditor.currentContinuous')}</h3>
              <RangeField label={t('node.multiAngleEditor.horizontalOrbit')} value={selected.yawControlDeg} min={-90} max={90} step={1} suffix="°" onChange={(value) => patchContinuous({ yawControlDeg: value })} />
              <RangeField label={t('node.multiAngleEditor.verticalPitch')} value={selected.verticalControl} min={-1} max={1} step={0.05} suffix="" valueText={describeLocalizedMultiAngleVertical(t, selected.verticalControl)} onChange={(value) => patchContinuous({ verticalControl: value })} />
              <RangeField label={t('node.multiAngleEditor.shotZoom')} value={selected.proximity} min={0} max={10} step={0.5} suffix="" valueText={describeLocalizedMultiAngleProximity(t, selected.proximity)} onChange={(value) => patchContinuous({ proximity: value })} />
              <div className="flex items-center justify-between gap-3">
                <span className={UI_TEXT_LABEL_CLASS}>{t('node.multiAngleEditor.wideAngle')}</span>
                <UiSwitch checked={selected.wideAngle} onCheckedChange={(checked) => patchContinuous({ wideAngle: checked })} />
              </div>
            </section>
          ) : selected?.kind === 'flux' ? (
            <section className="mt-5 space-y-4">
              <h3 className={UI_TEXT_SECTION_CLASS}>{t('node.multiAngleEditor.currentFlux')}</h3>
              <RangeField label={t('node.multiAngleEditor.horizontalAngle')} value={selected.horizontalAngleDeg} min={0} max={360} step={1} suffix="°" onChange={(value) => patchFlux({ horizontalAngleDeg: value })} />
              <RangeField label={t('node.multiAngleEditor.verticalAngle')} value={selected.verticalAngleDeg} min={0} max={60} step={1} suffix="°" onChange={(value) => patchFlux({ verticalAngleDeg: value })} />
              <RangeField label={t('node.multiAngleEditor.zoom')} value={selected.zoom} min={0} max={10} step={0.5} suffix="" onChange={(value) => patchFlux({ zoom: value })} />
            </section>
          ) : (
            <section className="mt-5 space-y-3">
              <h3 className={UI_TEXT_SECTION_CLASS}>{t('node.multiAngleEditor.discretePresets')}</h3>
              <div className="grid grid-cols-3 gap-2">
                {MULTI_ANGLE_DISCRETE_VIEW_PRESETS.map((preset) => {
                  const active = config.views.some((view) => view.kind === 'discrete' && view.preset === preset.view.preset)
                  return (
                    <UiOptionButton
                      key={preset.id}
                      type="button"
                      variant="flat"
                      active={active}
                      className="justify-center px-1 text-xs"
                      onClick={() => {
                        if (active) {
                          const current = config.views.find((view) => view.kind === 'discrete' && view.preset === preset.view.preset)
                          if (current) setSelectedViewId(current.viewId)
                          return
                        }
                        if (config.views.length >= MULTI_ANGLE_MAX_VIEW_COUNT) return
                        updateConfig({ ...config, views: [...config.views, { ...preset.view }] })
                        setSelectedViewId(preset.view.viewId)
                      }}
                    >
                      {translateMultiAngleViewLabel(t, preset.view)}
                    </UiOptionButton>
                  )
                })}
              </div>
            </section>
          )}

          <div className="mt-5 flex items-start gap-2 rounded-lg bg-layer px-3 py-2 text-xs text-text-soft">
            <Aperture className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('node.multiAngleEditor.profileNote', { max: MULTI_ANGLE_MAX_VIEW_COUNT })}</span>
          </div>
        </div>
      </div>
  )
}

export default function MultiAngleSpecialEditor({
  session,
  onDraftChange,
  onConfirm,
  onCancel,
  onKeepEditing,
  onDiscard,
}: CanvasSpecialEditorSurfaceProps): JSX.Element {
  const { t } = useTranslation()
  const config = useMemo(() => readConfig(session.draftState), [session.draftState])
  const sourceImage = sourceImageFromState(session.draftState)
  const close = (): void => { onCancel() }
  return (
    <UiModal
      isOpen
      title={t('node.multiAngleEditor.title')}
      size="workspace"
      surface="glass"
      contentClassName="min-h-0 p-0"
      onClose={close}
      footer={session.discardConfirmationRequested ? (
        <div className="flex w-full items-center justify-between gap-3">
          <p className={UI_TEXT_META_CLASS}>{t('node.multiAngleEditor.discardPrompt')}</p>
          <div className="flex items-center gap-2">
            <UiButton type="button" variant="ghost" size="sm" onClick={onKeepEditing}>{t('node.multiAngleEditor.keepEditing')}</UiButton>
            <UiButton type="button" variant="primary" size="sm" onClick={onDiscard}>{t('node.multiAngleEditor.discard')}</UiButton>
          </div>
        </div>
      ) : (
        <>
          <UiButton type="button" variant="ghost" size="sm" onClick={close}>{t('common.cancel')}</UiButton>
          <UiButton type="button" variant="primary" size="sm" onClick={onConfirm}>{t('node.multiAngleEditor.apply')}</UiButton>
        </>
      )}
    >
      <MultiAngleWorkbench
        config={config}
        sourceImage={sourceImage}
        onConfigChange={(next) => onDraftChange(buildMultiAngleEditorDraft(session.draftState, next))}
      />
    </UiModal>
  )
}
