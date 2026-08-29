import { useMemo, useState } from 'react'
import { Aperture, Camera, Plus, Trash2 } from 'lucide-react'

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
  MULTI_ANGLE_MAX_VIEW_COUNT,
  createDefaultMultiAngleConfig,
  normalizeMultiAngleConfig,
  type MultiAngleConfigV1,
  type MultiAngleContinuousViewV1,
  type MultiAngleControlProfile,
  type MultiAngleDiscretePreset,
  type MultiAngleViewV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import type { CanvasSpecialEditorSurfaceProps } from '../specialEditorRegistry'
import { buildMultiAngleEditorDraft } from './multiAngleEditorState'
import {
  describeMultiAngleCamera,
  describeMultiAngleProximity,
  describeMultiAngleVertical,
} from './multiAngleCameraVisualizerState'
import { MultiAngleOrbitPreview } from './MultiAngleOrbitPreview'

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
    : MULTI_ANGLE_DISCRETE_VIEW_PRESETS
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

export default function MultiAngleSpecialEditor({
  session,
  onDraftChange,
  onConfirm,
  onCancel,
  onKeepEditing,
  onDiscard,
}: CanvasSpecialEditorSurfaceProps): JSX.Element {
  const config = useMemo(() => readConfig(session.draftState), [session.draftState])
  const sourceImage = sourceImageFromState(session.draftState)
  const [selectedViewId, setSelectedViewId] = useState(config.views[0]?.viewId ?? '')
  const selected = config.views.find((view) => view.viewId === selectedViewId) ?? config.views[0]

  const updateConfig = (next: MultiAngleConfigV1): void => {
    const normalized = normalizeMultiAngleConfig(next)
    onDraftChange(buildMultiAngleEditorDraft(session.draftState, normalized))
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
      label: `自定义视角 ${index + 1}`,
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
  const close = (): void => { onCancel() }

  return (
    <UiModal
      isOpen
      title="多角度视图"
      size="workspace"
      surface="glass"
      contentClassName="min-h-0 p-0"
      onClose={close}
      footer={session.discardConfirmationRequested ? (
        <div className="flex w-full items-center justify-between gap-3">
          <p className={UI_TEXT_META_CLASS}>有尚未应用的角度设置，确定放弃吗？</p>
          <div className="flex items-center gap-2">
            <UiButton type="button" variant="ghost" size="sm" onClick={onKeepEditing}>继续编辑</UiButton>
            <UiButton type="button" variant="primary" size="sm" onClick={onDiscard}>放弃更改</UiButton>
          </div>
        </div>
      ) : (
        <>
          <UiButton type="button" variant="ghost" size="sm" onClick={close}>取消</UiButton>
          <UiButton type="button" variant="primary" size="sm" onClick={onConfirm}>应用设置</UiButton>
        </>
      )}
    >
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-0 items-center justify-center p-4">
          <div className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-veil-subtle ${UI_GLASS_ADAPTIVE_SURFACE_CLASS}`}>
            {sourceImage ? (
              <img src={resolveImageDisplayUrl(sourceImage)} alt="多角度源图" className="max-h-[76%] max-w-[76%] object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-muted">
                <Camera className="h-8 w-8" />
                <p className="text-sm">请先为节点连接一张源图</p>
              </div>
            )}
            <MultiAngleOrbitPreview
              views={config.views}
              selectedViewId={selected?.viewId ?? ''}
              onContinuousChange={patchContinuous}
              onDiscretePresetChange={chooseDiscretePreset}
            />
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-sticky rounded-lg bg-overlay px-3 py-2">
              <p className="truncate text-xs font-medium text-text">{selected ? describeMultiAngleCamera(selected) : '未选择视图'}</p>
              <p className="mt-0.5 text-3xs text-text-muted">{selected?.kind === 'continuous' ? '拖动改变环绕与俯仰 · 滚轮改变景别' : '拖动或点击，吸附到模型支持的完整方位'}</p>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-sticky rounded-lg bg-overlay px-3 py-2 text-xs text-text-soft">
              可视轨道只编辑模型控制量，不代表真实焦距、物理角度或空间重建精度。
            </div>
          </div>
        </div>

        <div className={`min-h-0 overflow-y-auto border-l border-veil-subtle p-4 ${UI_GLASS_ADAPTIVE_REGION_CLASS}`}>
          <section className="space-y-3">
            <h3 className={UI_TEXT_SECTION_CLASS}>控制方式</h3>
            <div className="grid grid-cols-2 gap-2">
              <UiOptionButton
                type="button"
                variant="flat"
                active={config.controlProfile === 'continuous-v1'}
                onClick={() => selectProfile('continuous-v1')}
              >
                <span className="flex flex-col"><span className="text-sm font-medium">连续控制</span><span className="text-xs text-text-soft">模型控制量</span></span>
              </UiOptionButton>
              <UiOptionButton
                type="button"
                variant="flat"
                active={config.controlProfile === 'discrete-v1'}
                onClick={() => selectProfile('discrete-v1')}
              >
                <span className="flex flex-col"><span className="text-sm font-medium">完整方位</span><span className="text-xs text-text-soft">九档吸附</span></span>
              </UiOptionButton>
            </div>
          </section>

          <section className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className={UI_TEXT_SECTION_CLASS}>输出视图 · {config.views.length}/{MULTI_ANGLE_MAX_VIEW_COUNT}</h3>
              <div className="flex items-center gap-1">
                <UiIconButton type="button" appearance="hover-only" showBorder={false} aria-label="移除当前视图" disabled={config.views.length <= 1} onClick={removeSelected}>
                  <Trash2 className="h-4 w-4" />
                </UiIconButton>
                <UiIconButton type="button" appearance="hover-only" showBorder={false} aria-label="添加视图" disabled={!nextUnusedView(config)} onClick={addView}>
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
                  <span className="truncate text-xs">{index + 1}. {view.label}</span>
                </UiOptionButton>
              ))}
            </div>
          </section>

          {selected?.kind === 'continuous' ? (
            <section className="mt-5 space-y-4">
              <h3 className={UI_TEXT_SECTION_CLASS}>当前视图 · 模型控制</h3>
              <RangeField label="水平环绕" value={selected.yawControlDeg} min={-90} max={90} step={1} suffix="°" onChange={(value) => patchContinuous({ yawControlDeg: value })} />
              <RangeField label="垂直俯仰" value={selected.verticalControl} min={-1} max={1} step={0.05} suffix="" valueText={describeMultiAngleVertical(selected.verticalControl)} onChange={(value) => patchContinuous({ verticalControl: value })} />
              <RangeField label="景别缩放" value={selected.proximity} min={0} max={10} step={0.5} suffix="" valueText={describeMultiAngleProximity(selected.proximity)} onChange={(value) => patchContinuous({ proximity: value })} />
              <div className="flex items-center justify-between gap-3">
                <span className={UI_TEXT_LABEL_CLASS}>广角镜头</span>
                <UiSwitch checked={selected.wideAngle} onCheckedChange={(checked) => patchContinuous({ wideAngle: checked })} />
              </div>
            </section>
          ) : (
            <section className="mt-5 space-y-3">
              <h3 className={UI_TEXT_SECTION_CLASS}>可用方位 · 点击吸附</h3>
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
                      {preset.label}
                    </UiOptionButton>
                  )
                })}
              </div>
            </section>
          )}

          <div className="mt-5 flex items-start gap-2 rounded-lg bg-layer px-3 py-2 text-xs text-text-soft">
            <Aperture className="mt-0.5 h-4 w-4 shrink-0" />
            <span>连续控制首版最多 6 次独立请求；完整方位档不会与连续档混在同一个结果组。</span>
          </div>
        </div>
      </div>
    </UiModal>
  )
}
