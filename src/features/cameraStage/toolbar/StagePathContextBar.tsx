import React from 'react'
import { RotateCcw, SlidersHorizontal, Spline } from 'lucide-react'
import { Dropdown, PanelTrigger, UiButton, UiIconButton, UiInput } from '@/components/ui'
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
    <label className="flex items-center justify-between gap-3 text-xs text-text-muted">
      <span className="shrink-0">{label}</span>
      <UiInput
        type="number"
        step={0.1}
        value={value}
        className="h-8 w-24 rounded-md px-2 text-right text-xs tabular-nums"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )

  const pathOptions = object.type === 'camera' ? CAMERA_PATH_OPTIONS : BASE_PATH_OPTIONS
  const pathLabel = pathOptions.find((option) => option.value === pathChoice)?.label ?? '直线'
  const speedPreset = detail.speedPreset ?? 'easeInOut'
  const speedLabel = SPEED_OPTIONS.find((option) => option.value === speedPreset)?.label ?? '平滑'

  return (
    <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <div
        className="flex min-w-0 items-center gap-1.5 text-xs text-text-dark"
        title={`${object.name}，关键帧 ${stateKeyframeIndex + 1} 到 ${stateKeyframeIndex + 2}`}
      >
        <Spline size={14} className="text-accent" />
        <span className="max-w-24 truncate font-medium">{object.name}</span>
        <span className="text-text-muted">{stateKeyframeIndex + 1} → {stateKeyframeIndex + 2}</span>
      </div>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-border-dark" />

      <Dropdown<PathChoice>
        value={pathChoice}
        display={`路径 · ${pathLabel}`}
        options={pathOptions}
        onSelect={handlePathChoice}
        buttonClassName="h-8 w-36 rounded-md py-1 text-xs"
        buttonLabelClassName="text-xs"
        optionLabelClassName="text-xs"
        panelWidthStrategy="options"
      />
      <Dropdown<StageSpeedPreset>
        value={speedPreset}
        display={`速度 · ${speedLabel}`}
        options={SPEED_OPTIONS}
        onSelect={(nextSpeedPreset) => updateDetail({ speedPreset: nextSpeedPreset })}
        buttonClassName="h-8 w-28 rounded-md py-1 text-xs"
        buttonLabelClassName="text-xs"
        optionLabelClassName="text-xs"
      />

      <PanelTrigger
        panelWidth={272}
        panelClassName="p-3"
        renderPanel={() => (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center justify-between gap-3 text-xs text-text-muted">
                <span className="shrink-0">起步延迟</span>
                <div className="flex items-center gap-1.5">
                  <UiInput
                    type="number"
                    min={0}
                    step={0.1}
                    value={detail.delay ?? 0}
                    className="h-8 w-20 rounded-md px-2 text-right text-xs tabular-nums"
                    onChange={(event) => updateDetail({ delay: Math.max(0, Number(event.target.value)) })}
                  />
                  <span className="text-2xs text-text-muted">秒</span>
                </div>
              </label>
              <p className="text-2xs leading-4 text-text-muted">
                本段过渡开始后，等待这段时间再让当前对象开始移动。
              </p>
            </div>

            {activePreset?.kind === 'orbit' && (
              <>
                {parameterInput('环绕角度', activePreset.degrees, (degrees) => updatePreset({ ...activePreset, degrees }))}
                <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
                  <span>环绕方向</span>
                  <Dropdown<'cw' | 'ccw'>
                    value={activePreset.direction}
                    options={[{ label: '顺时针', value: 'cw' }, { label: '逆时针', value: 'ccw' }]}
                    onSelect={(direction) => updatePreset({ ...activePreset, direction })}
                    buttonClassName="h-8 w-24 rounded-md py-1 text-xs"
                    buttonLabelClassName="text-xs"
                  />
                </div>
              </>
            )}
            {(activePreset?.kind === 'dollyIn' || activePreset?.kind === 'dollyOut')
              && parameterInput('移动距离比', activePreset.distanceRatio, (distanceRatio) => updatePreset({ ...activePreset, distanceRatio }))}
            {activePreset?.kind === 'truck'
              && parameterInput('横移距离', activePreset.offset, (offset) => updatePreset({ ...activePreset, offset }))}
            {activePreset?.kind === 'crane'
              && parameterInput('升降高度', activePreset.height, (height) => updatePreset({ ...activePreset, height }))}

            {object.type === 'character' && (
              <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
                <span>角色动作</span>
                <Dropdown<string>
                  value={motionValue}
                  options={MOTION_OPTIONS}
                  onSelect={(value) => updateDetail({
                    motionOverride: value === 'auto'
                      ? undefined
                      : value === 'pose' || !isCharacterAnimationClipName(value)
                        ? createPoseMotion()
                        : createClipMotion(value),
                  })}
                  buttonClassName="h-8 w-36 rounded-md py-1 text-xs"
                  buttonLabelClassName="text-xs"
                  panelWidthStrategy="options"
                />
              </div>
            )}

            {originPreset && (
              <UiButton
                size="sm"
                variant="ghost"
                className="h-8 justify-start rounded-md px-2 text-xs"
                title="丢弃手动修改并重新生成预设路径"
                onClick={() => updatePreset(originPreset)}
              >
                <RotateCcw size={13} className="mr-1.5" />重新应用原预设
              </UiButton>
            )}
          </div>
        )}
      >
        {({ togglePanel, open }) => (
          <UiIconButton
            showBorder={false}
            active={open}
            className="h-8 w-8 rounded-md"
            title="更多路径参数"
            aria-label="更多路径参数"
            onClick={togglePanel}
            data-panel-trigger-button
          >
            <SlidersHorizontal size={14} />
          </UiIconButton>
        )}
      </PanelTrigger>

      {path && (
        <UiIconButton
          showBorder={false}
          className="h-8 w-8 rounded-md"
          title="重置为直线"
          aria-label="重置为直线"
          onClick={() => setStateKeyframeSpatialPath(stateKeyframe.id, object.id, undefined)}
        >
          <RotateCcw size={14} />
        </UiIconButton>
      )}
    </div>
  )
}

export default StagePathContextBar
