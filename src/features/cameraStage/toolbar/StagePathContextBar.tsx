import React from 'react'
import { RotateCcw, SlidersHorizontal, Spline } from 'lucide-react'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, PanelTrigger, UiButton, UiFormRow, UiIconButton, UiOverflowRow, type UiOverflowRowItem } from '@/components/ui'
import {
  CHARACTER_ANIMATION_CLIPS,
  createClipMotion,
  createPoseMotion,
  isCharacterAnimationClipName,
} from '../domain/characterMotion'
import { STAGE_CAMERA_MOVE_DEFAULTS } from '../domain/stateKeyframeCameraMovePresets'
import { defaultSpatialPath, markSpatialPathCustom } from '../domain/spatialPath'
import type {
  StageCameraMovePreset,
  StageSpeedPreset,
} from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { useCameraStageToolStore } from '../store/cameraStageToolStore'

type PathChoice = 'linear' | 'custom' | StageCameraMovePreset['kind']

const SPEED_OPTIONS: Array<{ label: string; value: StageSpeedPreset }> = [
  { label: '匀速', value: 'uniform' },
  { label: '平滑', value: 'easeInOut' },
  { label: '快速起步', value: 'fastStart' },
  { label: '缓慢起步', value: 'slowStart' },
]

const BASE_PATH_OPTIONS: Array<{ label: string; value: PathChoice }> = [
  { label: '直线', value: 'linear' },
  { label: '自定义贝塞尔', value: 'custom' },
]

const CAMERA_PATH_OPTIONS: Array<{ label: string; value: PathChoice }> = [
  ...BASE_PATH_OPTIONS,
  { label: '环绕', value: 'orbit' },
  { label: '推进', value: 'dollyIn' },
  { label: '拉远', value: 'dollyOut' },
  { label: '横移', value: 'truck' },
  { label: '升降', value: 'crane' },
]

const MOTION_OPTIONS = [
  { label: '自动（推荐）', value: 'auto' },
  { label: '无动作', value: 'pose' },
  ...CHARACTER_ANIMATION_CLIPS.map((clip) => ({ label: clip.label, value: clip.clipName })),
]

function defaultPreset(kind: StageCameraMovePreset['kind']): StageCameraMovePreset {
  if (kind === 'orbit') {
    return {
      kind,
      degrees: STAGE_CAMERA_MOVE_DEFAULTS.orbitDegrees,
      direction: STAGE_CAMERA_MOVE_DEFAULTS.orbitDirection,
    }
  }
  if (kind === 'dollyIn') return { kind, distanceRatio: STAGE_CAMERA_MOVE_DEFAULTS.dollyInRatio }
  if (kind === 'dollyOut') return { kind, distanceRatio: STAGE_CAMERA_MOVE_DEFAULTS.dollyOutRatio }
  if (kind === 'truck') return { kind, offset: STAGE_CAMERA_MOVE_DEFAULTS.truckOffset }
  return { kind: 'crane', height: STAGE_CAMERA_MOVE_DEFAULTS.craneHeight }
}

const StagePathContextBar: React.FC = () => {
  const selection = useCameraStageToolStore((state) => state.pathSelection)
  const tool = useCameraStageToolStore((state) => state.tool)
  const stateKeyframes = useCameraStageStore((state) => state.stateKeyframes)
  const objects = useCameraStageStore((state) => state.objects)
  const setStateKeyframeSpatialPath = useCameraStageStore((state) => state.setStateKeyframeSpatialPath)
  const applyCameraPathPreset = useCameraStageStore((state) => state.applyCameraPathPreset)
  const updateStateKeyframeTransition = useCameraStageStore((state) => state.updateStateKeyframeTransition)

  if (tool !== 'path' || !selection) return null
  const stateKeyframeIndex = stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === selection.stateKeyframeId)
  const stateKeyframe = stateKeyframes[stateKeyframeIndex]
  const nextStateKeyframe = stateKeyframes[stateKeyframeIndex + 1]
  const object = objects.find((item) => item.id === selection.objectId)
  const fromPosition = stateKeyframe?.objectStates[selection.objectId]?.transform.position
  const toPosition = nextStateKeyframe?.objectStates[selection.objectId]?.transform.position
  if (!stateKeyframe || !nextStateKeyframe || !object || !fromPosition || !toPosition) return null

  const detail = stateKeyframe.transition.perObject[object.id] ?? {}
  const path = detail.spatialPath
  const pathChoice: PathChoice = path?.source.kind === 'preset'
    ? path.source.preset.kind
    : path ? 'custom' : 'linear'
  const activePreset = path?.source.kind === 'preset' ? path.source.preset : undefined
  const originPreset = path?.source.kind === 'custom' ? path.source.originPreset : undefined
  const motionValue = detail.motionOverride?.mode === 'clip'
    ? detail.motionOverride.clipName
    : detail.motionOverride ? 'pose' : 'auto'

  const updateDetail = (patch: Partial<typeof detail>): void => {
    updateStateKeyframeTransition(stateKeyframe.id, {
      perObject: { [object.id]: { ...detail, ...patch } },
    })
  }

  const handlePathChoice = (choice: PathChoice): void => {
    if (choice === 'linear') {
      setStateKeyframeSpatialPath(stateKeyframe.id, object.id, undefined)
      return
    }
    if (choice === 'custom') {
      setStateKeyframeSpatialPath(
        stateKeyframe.id,
        object.id,
        path ? markSpatialPathCustom(path) : defaultSpatialPath(fromPosition, toPosition),
      )
      return
    }
    applyCameraPathPreset(stateKeyframe.id, object.id, defaultPreset(choice))
  }

  const updatePreset = (preset: StageCameraMovePreset): void => {
    applyCameraPathPreset(stateKeyframe.id, object.id, preset)
  }

  const parameterInput = (label: string, value: number, onChange: (value: number) => void): React.ReactNode => (
    <UiFormRow label={label} density="compact" inline>
      <NumberInput
        ariaLabel={label}
        size="sm"
        value={value}
        step={0.1}
        precision={2}
        widthClassName="w-24"
        align="right"
        commitOnChange
        wheelStep
        onChange={onChange}
      />
    </UiFormRow>
  )

  const pathOptions = object.type === 'camera' ? CAMERA_PATH_OPTIONS : BASE_PATH_OPTIONS
  const pathLabel = pathOptions.find((option) => option.value === pathChoice)?.label ?? '直线'
  const speedPreset = detail.speedPreset ?? 'easeInOut'
  const speedLabel = SPEED_OPTIONS.find((option) => option.value === speedPreset)?.label ?? '平滑'

  // 命令带中间放不下时（960、展开助手侧栏），按优先级把对象标签、速度、路径、重置收进“更多路径参数”，
  // 命令带不溢出、不压住右端动作（5.5 3D-13）。
  const items: UiOverflowRowItem[] = [
    {
      id: 'label',
      priority: 10,
      node: (
        <div
          className="mr-1.5 flex min-w-0 items-center gap-1.5 text-xs text-text1"
          title={`${object.name}，关键帧 ${stateKeyframeIndex + 1} 到 ${stateKeyframeIndex + 2}`}
        >
          <Spline aria-hidden="true" size={16} className="text-accent-text" />
          <span className="max-w-24 truncate font-medium">{object.name}</span>
          <span className="text-text3">{stateKeyframeIndex + 1} → {stateKeyframeIndex + 2}</span>
        </div>
      ),
    },
    {
      id: 'path',
      priority: 40,
      node: (
        <Dropdown<PathChoice>
          value={pathChoice}
          ariaLabel="路径"
          display={`路径 · ${pathLabel}`}
          options={pathOptions}
          onSelect={handlePathChoice}
          size="md" buttonClassName="w-36"
          panelWidthStrategy="options"
        />
      ),
    },
    {
      id: 'speed',
      priority: 30,
      node: (
        <Dropdown<StageSpeedPreset>
          value={speedPreset}
          ariaLabel="速度"
          display={`速度 · ${speedLabel}`}
          options={SPEED_OPTIONS}
          onSelect={(nextSpeedPreset) => updateDetail({ speedPreset: nextSpeedPreset })}
          size="md" buttonClassName="w-28"
        />
      ),
    },
    ...(path ? [{
      id: 'reset',
      priority: 20,
      node: (
        <UiIconButton size="lg"
          title="重置为直线"
          aria-label="重置为直线"
          onClick={() => setStateKeyframeSpatialPath(stateKeyframe.id, object.id, undefined)}
        >
          <RotateCcw size={16} />
        </UiIconButton>
      ),
    }] : []),
  ]

  return (
    <UiOverflowRow
      className="pointer-events-auto w-full justify-center gap-1.5 whitespace-nowrap"
      items={items}
      alwaysShowOverflow
      renderOverflow={(hiddenIds) => (
      <PanelTrigger
        panelWidth={288}
        panelPadding="content"
        renderPanel={() => (
          <div className="flex flex-col gap-3">
            {hiddenIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {items.filter((item) => hiddenIds.includes(item.id)).map((item) => <div key={item.id} className="flex items-center">{item.node}</div>)}
              </div>
            ) : null}
            <UiFormRow
              label="起步延迟（秒）"
              info="本段过渡开始后，等待这段时间再让当前对象开始移动。"
              density="compact"
              inline
            >
              <NumberInput
                ariaLabel="起步延迟（秒）"
                size="sm"
                value={detail.delay ?? 0}
                min={0}
                step={0.1}
                precision={1}
                widthClassName="w-24"
                align="right"
                commitOnChange
                wheelStep
                onChange={(delay) => updateDetail({ delay: Math.max(0, delay) })}
              />
            </UiFormRow>

            {activePreset?.kind === 'orbit' && (
              <>
                {parameterInput('环绕角度', activePreset.degrees, (degrees) => updatePreset({ ...activePreset, degrees }))}
                <UiFormRow label="环绕方向" density="compact" inline>
                  <Dropdown<'cw' | 'ccw'>
                    ariaLabel="环绕方向"
                    value={activePreset.direction}
                    display={activePreset.direction === 'cw' ? '顺时针' : '逆时针'}
                    options={[{ label: '顺时针', value: 'cw' }, { label: '逆时针', value: 'ccw' }]}
                    onSelect={(direction) => updatePreset({ ...activePreset, direction })}
                    size="sm" buttonClassName="w-24"
                  />
                </UiFormRow>
              </>
            )}
            {(activePreset?.kind === 'dollyIn' || activePreset?.kind === 'dollyOut')
              && parameterInput('移动距离比', activePreset.distanceRatio, (distanceRatio) => updatePreset({ ...activePreset, distanceRatio }))}
            {activePreset?.kind === 'truck'
              && parameterInput('横移距离', activePreset.offset, (offset) => updatePreset({ ...activePreset, offset }))}
            {activePreset?.kind === 'crane'
              && parameterInput('升降高度', activePreset.height, (height) => updatePreset({ ...activePreset, height }))}

            {object.type === 'character' && (
              <UiFormRow label="角色动作" density="compact" inline>
                <Dropdown<string>
                  ariaLabel="角色动作"
                  value={motionValue}
                  options={MOTION_OPTIONS}
                  onSelect={(value) => updateDetail({
                    motionOverride: value === 'auto'
                      ? undefined
                      : value === 'pose' || !isCharacterAnimationClipName(value)
                        ? createPoseMotion()
                        : createClipMotion(value),
                  })}
                  size="sm" buttonClassName="w-36"
                  panelWidthStrategy="options"
                />
              </UiFormRow>
            )}

            {originPreset && (
              <UiButton
                size="sm"
                className="justify-start gap-1.5"
                title="丢弃手动修改并重新生成预设路径"
                onClick={() => updatePreset(originPreset)}
              >
                <RotateCcw size={14} />重新应用原预设
              </UiButton>
            )}
          </div>
        )}
      >
        {({ togglePanel, open }) => (
          <UiIconButton size="lg"
            on={open}
            title="更多路径参数"
            aria-label="更多路径参数"
            onClick={togglePanel}
            data-panel-trigger-button
          >
            <SlidersHorizontal size={16} />
          </UiIconButton>
        )}
      </PanelTrigger>
      )}
    />
  )
}

export default StagePathContextBar
