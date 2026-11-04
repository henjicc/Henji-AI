import React, { useDeferredValue, useMemo, useState } from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiButton, UiError, UiFormRow, UiGroup, UiSegmented, UiSeedInput, UiSwitch } from '@/components/ui'
import {
  CAMERA_STAGE_CITY_STYLE_LABELS,
  CAMERA_STAGE_CITY_STYLES,
  CAMERA_STAGE_ROAD_CLASS_LABELS,
  CAMERA_STAGE_ROAD_CLASSES,
  CAMERA_STAGE_SET_PRESET_LABELS,
  CAMERA_STAGE_SET_PRESETS,
  CITY_STYLE_DEFAULT_FLOORS,
  STAGE_SET_DEFAULTS,
  type CameraStageFloorRange,
  type CameraStageSetParams,
  type CameraStageSetPreset,
} from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'
import { buildStageSet, estimateStageSet, isKnownStageSetPreset, liveStageSets, randomStageSetSeed } from '../domain/stageSets'
import type { StageSet } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

/**
 * 布景面板：选类型、调几项意图参数、生成。选中某片布景的成员再打开时，编辑的就是那片布景（重新生成或整片删除）。
 * 与助手的 generate_camera_stage_set 走同一条路：buildStageSet 算出布景，store.applyStageSet 一次落地、一条撤销记录。
 */

type Params<P extends CameraStageSetPreset> = Extract<CameraStageSetParams, { preset: P }>

const NO_GESTURE = { onBegin: () => {}, onFinish: () => {}, onCancel: () => {} }

function defaultsFor(preset: CameraStageSetPreset): CameraStageSetParams {
  return { ...structuredClone(STAGE_SET_DEFAULTS[preset]), seed: randomStageSetSeed() } as CameraStageSetParams
}

function NumberRow({ label, value, onChange, min = 0.5, max, step = 1, precision = 0, unit }: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  precision?: number
  unit?: string
}): React.ReactElement {
  return (
    <UiFormRow label={unit ? `${label}（${unit}）` : label} density="compact">
      <NumberInput ariaLabel={label} value={value} onChange={onChange} min={min} max={max} scrubMax={max} step={step} precision={precision} size="sm" />
    </UiFormRow>
  )
}

/** 面板只放最常调的几项；最少层数等细项沿用当前值，助手可以按 layout 全部指定。 */
function MaxFloorsRow({ value, onChange }: { value: CameraStageFloorRange; onChange: (value: CameraStageFloorRange) => void }): React.ReactElement {
  return <NumberRow label="最高" unit="层" value={value.max} min={1} max={200} onChange={max => {
    const floors = Math.max(1, Math.round(max))
    onChange({ min: Math.min(value.min, floors), max: floors })
  }} />
}

function DensityRow({ value, onChange }: { value: number; onChange: (value: number) => void }): React.ReactElement {
  return <NumberRow label="密度" unit="%" value={Math.round(value * 100)} min={0} max={100} onChange={next => onChange(Math.max(0, Math.min(100, next)) / 100)} />
}

function PropsRow({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }): React.ReactElement {
  return (
    <UiFormRow label="参照物" density="compact" info="人行道、车道线、行道树、路灯和车辆，按真实尺寸摆放，帮生成模型判断画面尺度">
      <UiSwitch checked={value} onCheckedChange={onChange} />
    </UiFormRow>
  )
}

function PresetFields({ params, update }: { params: CameraStageSetParams; update: (patch: Partial<CameraStageSetParams>) => void }): React.ReactElement {
  if (params.preset === 'city') {
    const city = params as Params<'city'>
    return <>
      <UiFormRow label="风格" density="compact">
        <UiSegmented ariaLabel="城市风格" size="sm" value={city.style}
          onChange={style => update({ style, floors: { ...CITY_STYLE_DEFAULT_FLOORS[style] } })}
          options={CAMERA_STAGE_CITY_STYLES.map(style => ({ value: style, label: CAMERA_STAGE_CITY_STYLE_LABELS[style] }))} />
      </UiFormRow>
      <NumberRow label="范围" unit="米" value={Math.max(city.width, city.depth)} min={100} onChange={size => update({ width: size, depth: size })} />
      <DensityRow value={city.density} onChange={density => update({ density })} />
      <MaxFloorsRow value={city.floors} onChange={floors => update({ floors })} />
      <UiFormRow label="楼高分布" density="compact">
        <UiSegmented ariaLabel="楼高分布" size="sm" value={city.heightProfile} onChange={heightProfile => update({ heightProfile })}
          options={[{ value: 'downtown', label: '中心高' }, { value: 'uniform', label: '均匀' }]} />
      </UiFormRow>
      <PropsRow value={city.props} onChange={props => update({ props })} />
    </>
  }
  if (params.preset === 'street') {
    const street = params as Params<'street'>
    return <>
      <NumberRow label="长度" unit="米" value={street.length} min={20} onChange={length => update({ length })} />
      <UiFormRow label="道路" density="compact">
        <UiSegmented ariaLabel="道路等级" size="sm" value={street.road} onChange={road => update({ road })}
          options={CAMERA_STAGE_ROAD_CLASSES.map(road => ({ value: road, label: CAMERA_STAGE_ROAD_CLASS_LABELS[road] }))} />
      </UiFormRow>
      <DensityRow value={street.density} onChange={density => update({ density })} />
      <MaxFloorsRow value={street.floors} onChange={floors => update({ floors })} />
      <PropsRow value={street.props} onChange={props => update({ props })} />
    </>
  }
  if (params.preset === 'plaza') {
    const plaza = params as Params<'plaza'>
    return <>
      <NumberRow label="广场边长" unit="米" value={plaza.size} min={10} onChange={size => update({ size })} />
      <DensityRow value={plaza.density} onChange={density => update({ density })} />
      <MaxFloorsRow value={plaza.floors} onChange={floors => update({ floors })} />
      <UiFormRow label="纪念碑" density="compact">
        <UiSwitch checked={plaza.monument} onCheckedChange={monument => update({ monument })} />
      </UiFormRow>
      <PropsRow value={plaza.props} onChange={props => update({ props })} />
    </>
  }
  const crowd = params as Params<'crowd'>
  return <>
    <NumberRow label="人数" value={crowd.count} min={1} onChange={count => update({ count: Math.max(1, Math.round(count)) })} />
    <UiFormRow label="队形" density="compact">
      <UiSegmented ariaLabel="队形" size="sm" value={crowd.formation} onChange={formation => update({ formation })}
        options={[{ value: 'grid', label: '方阵' }, { value: 'scatter', label: '散开' }, { value: 'ring', label: '围圈' }]} />
    </UiFormRow>
    <NumberRow label="间距" unit="米" value={crowd.spacing} min={0.3} step={0.1} precision={1} onChange={spacing => update({ spacing })} />
    <UiFormRow label="朝向" density="compact">
      <UiSegmented ariaLabel="朝向" size="sm" value={crowd.facing} onChange={facing => update({ facing })}
        options={[{ value: 'forward', label: '统一' }, { value: 'center', label: '朝中心' }, { value: 'random', label: '随机' }]} />
    </UiFormRow>
  </>
}

export function StageSetPanel({ onDone }: { onDone: () => void }): React.ReactElement {
  const editing = useMemo<StageSet | undefined>(() => {
    const state = useCameraStageStore.getState()
    const setId = state.objects.find(object => object.id === state.selectedId)?.setId
    const set = setId ? liveStageSets(state.sets, state.objects).find(candidate => candidate.id === setId) : undefined
    // 更新版本才有的布景类型这里改不了，按新建处理。
    return set && isKnownStageSetPreset(set.params.preset) ? set : undefined
  }, [])
  const [params, setParams] = useState<CameraStageSetParams>(() => editing ? structuredClone(editing.params) : defaultsFor('city'))
  const [error, setError] = useState<string>()
  const update = (patch: Partial<CameraStageSetParams>): void => setParams(current => ({ ...current, ...patch }) as CameraStageSetParams)
  // 数楼要把整片布局算一遍；拖动数值时延后算，输入不卡。
  const deferredParams = useDeferredValue(params)
  const estimate = useMemo(() => estimateStageSet(deferredParams), [deferredParams])

  const generate = (): void => {
    const state = useCameraStageStore.getState()
    try {
      const { set, objects } = buildStageSet(liveStageSets(state.sets, state.objects), {
        layout: params,
        ...(editing && editing.params.preset === params.preset ? { replaceSetId: editing.id } : {}),
      })
      state.applyStageSet(set, objects)
      onDone()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message.replace(/^[A-Z_]+：/, '') : '请调整参数后重试。')
    }
  }
  const remove = (): void => {
    if (editing) useCameraStageStore.getState().removeStageSet(editing.id)
    onDone()
  }
  const replacing = Boolean(editing && editing.params.preset === params.preset)

  return (
    <div className="flex w-72 max-w-full flex-col gap-4" data-camera-stage-set-panel>
      <UiGroup labelWidth={96}>
        <UiFormRow label="类型" density="compact">
          <UiSegmented<CameraStageSetPreset> ariaLabel="布景类型" size="sm" value={params.preset}
            onChange={preset => setParams(editing?.params.preset === preset ? structuredClone(editing.params) : defaultsFor(preset))}
            options={CAMERA_STAGE_SET_PRESETS.map(preset => ({ value: preset, label: CAMERA_STAGE_SET_PRESET_LABELS[preset] }))} />
        </UiFormRow>
        <PresetFields params={params} update={update} />
        <UiFormRow label="随机种子" density="compact">
          <UiSeedInput aria-label="随机种子" value={params.seed} onChange={seed => update({ seed })} size="sm" {...NO_GESTURE} />
        </UiFormRow>
      </UiGroup>
      {error && <UiError size="sm" title="生成不了" message={error} />}
      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        <span className="mr-auto min-w-0 truncate text-xs text-text3">
          {params.preset === 'crowd' ? `${estimate.objects.toLocaleString()} 人` : `${estimate.buildings.toLocaleString()} 栋楼`}
        </span>
        {replacing && <UiButton variant="danger" size="sm" onClick={remove}>删除布景</UiButton>}
        <UiButton variant="primary" size="sm" disabled={estimate.objects === 0} disabledReason="调大密度" onClick={generate}>{replacing ? '重新生成' : '生成'}</UiButton>
      </div>
    </div>
  )
}
