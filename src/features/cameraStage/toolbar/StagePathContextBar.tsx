import React from 'react'
import { RotateCcw, Spline } from 'lucide-react'
import { Dropdown, UiButton, UiInput } from '@/components/ui'
import {
  CHARACTER_ANIMATION_CLIPS,
  createClipMotion,
  createPoseMotion,
  isCharacterAnimationClipName,
} from '../domain/characterMotion'
import { STAGE_CAMERA_MOVE_DEFAULTS } from '../domain/shotCameraMovePresets'
import { defaultSpatialPath, markSpatialPathCustom } from '../domain/spatialPath'
import type {
  StageCameraMovePreset,
  StageSpeedPreset,
} from '../domain/shotTypes'
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
  const shots = useCameraStageStore((state) => state.shots)
  const objects = useCameraStageStore((state) => state.objects)
  const setShotSpatialPath = useCameraStageStore((state) => state.setShotSpatialPath)
  const applyCameraPathPreset = useCameraStageStore((state) => state.applyCameraPathPreset)
  const updateShotTransition = useCameraStageStore((state) => state.updateShotTransition)

  if (tool !== 'path' || !selection) return null
  const shotIndex = shots.findIndex((shot) => shot.id === selection.shotId)
  const shot = shots[shotIndex]
  const nextShot = shots[shotIndex + 1]
  const object = objects.find((item) => item.id === selection.objectId)
  const fromPosition = shot?.objectStates[selection.objectId]?.transform.position
  const toPosition = nextShot?.objectStates[selection.objectId]?.transform.position
  if (!shot || !nextShot || !object || !fromPosition || !toPosition) return null

  const detail = shot.transition.perObject[object.id] ?? {}
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
    updateShotTransition(shot.id, {
      perObject: { [object.id]: { ...detail, ...patch } },
    })
  }

  const handlePathChoice = (choice: PathChoice): void => {
    if (choice === 'linear') {
      setShotSpatialPath(shot.id, object.id, undefined)
      return
    }
    if (choice === 'custom') {
      setShotSpatialPath(
        shot.id,
        object.id,
        path ? markSpatialPathCustom(path) : defaultSpatialPath(fromPosition, toPosition),
      )
      return
    }
    applyCameraPathPreset(shot.id, object.id, defaultPreset(choice))
  }

  const updatePreset = (preset: StageCameraMovePreset): void => {
    applyCameraPathPreset(shot.id, object.id, preset)
  }

  const parameterInput = (label: string, value: number, onChange: (value: number) => void): React.ReactNode => (
    <label className="flex h-8 shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
      <span>{label}</span>
      <UiInput
        type="number"
        step={0.1}
        value={value}
        className="h-8 w-20 rounded-md px-2 text-xs tabular-nums"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-30 flex h-11 max-w-[calc(100%_-_13rem)] -translate-x-1/2 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-lg border border-border-dark bg-surface-dark/95 px-2 shadow-lg backdrop-blur">
      <div className="flex h-8 shrink-0 items-center gap-1.5 text-xs text-text-dark">
        <Spline size={14} className="text-accent" />
        <span className="max-w-28 truncate font-medium">{object.name}</span>
        <span className="text-text-muted">{shotIndex + 1} → {shotIndex + 2}</span>
      </div>
      <span className="h-5 w-px shrink-0 bg-border-dark" />

      <div className="flex h-8 shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
        <span>路径</span>
        <Dropdown<PathChoice>
          value={pathChoice}
          options={object.type === 'camera' ? CAMERA_PATH_OPTIONS : BASE_PATH_OPTIONS}
          onSelect={handlePathChoice}
          buttonClassName="h-8 w-32 rounded-md py-1 text-xs"
          buttonLabelClassName="text-xs"
          optionLabelClassName="text-xs"
          panelWidthStrategy="options"
        />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
        <span>速度</span>
        <Dropdown<StageSpeedPreset>
          value={detail.speedPreset ?? 'easeInOut'}
          options={SPEED_OPTIONS}
          onSelect={(speedPreset) => updateDetail({ speedPreset })}
          buttonClassName="h-8 w-24 rounded-md py-1 text-xs"
          buttonLabelClassName="text-xs"
          optionLabelClassName="text-xs"
        />
      </div>
      {parameterInput('延迟', detail.delay ?? 0, (delay) => updateDetail({ delay }))}

      {activePreset?.kind === 'orbit' && (
        <>
          {parameterInput('角度', activePreset.degrees, (degrees) => updatePreset({ ...activePreset, degrees }))}
          <div className="flex h-8 shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
            <span>方向</span>
            <Dropdown<'cw' | 'ccw'>
              value={activePreset.direction}
              options={[{ label: '顺时针', value: 'cw' }, { label: '逆时针', value: 'ccw' }]}
              onSelect={(direction) => updatePreset({ ...activePreset, direction })}
              buttonClassName="h-8 w-20 rounded-md py-1 text-xs"
              buttonLabelClassName="text-xs"
            />
          </div>
        </>
      )}
      {(activePreset?.kind === 'dollyIn' || activePreset?.kind === 'dollyOut')
        && parameterInput('距离比', activePreset.distanceRatio, (distanceRatio) => updatePreset({ ...activePreset, distanceRatio }))}
      {activePreset?.kind === 'truck'
        && parameterInput('距离', activePreset.offset, (offset) => updatePreset({ ...activePreset, offset }))}
      {activePreset?.kind === 'crane'
        && parameterInput('高度', activePreset.height, (height) => updatePreset({ ...activePreset, height }))}

      {object.type === 'character' && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
          <span>动作</span>
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
            buttonClassName="h-8 w-32 rounded-md py-1 text-xs"
            buttonLabelClassName="text-xs"
            panelWidthStrategy="options"
          />
        </div>
      )}

      {originPreset && (
        <UiButton
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 rounded-md px-2 text-[11px]"
          title="丢弃手动修改并重新生成预设路径"
          onClick={() => updatePreset(originPreset)}
        >
          <RotateCcw size={12} className="mr-1" />重新应用预设
        </UiButton>
      )}
      {path && (
        <UiButton
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 rounded-md px-2 text-[11px]"
          onClick={() => setShotSpatialPath(shot.id, object.id, undefined)}
        >
          重置为直线
        </UiButton>
      )}
    </div>
  )
}

export default StagePathContextBar
