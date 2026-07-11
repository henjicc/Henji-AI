import React from 'react'
import { Camera, Cuboid, UserRound } from 'lucide-react'
import { Dropdown, UiInput, UiOptionButton } from '@/components/ui'
import { CHARACTER_ANIMATION_CLIPS, createClipMotion, createPoseMotion, isCharacterAnimationClipName } from '../domain/characterMotion'
import { STAGE_CAMERA_MOVE_DEFAULTS } from '../domain/shotCameraMovePresets'
import { defaultSpatialPath } from '../domain/spatialPath'
import type {
  StageCameraMove,
  StageShotTransitionObjectDetail,
  StageSpeedPreset,
} from '../domain/shotTypes'
import type { StageObject } from '../domain/sceneTypes'

interface TransitionObjectRowProps {
  object: StageObject
  fromPosition: StageObject['transform']['position']
  toPosition: StageObject['transform']['position']
  detail: StageShotTransitionObjectDetail
  cameraMove?: StageCameraMove
  onDetailChange: (detail: StageShotTransitionObjectDetail) => void
  onCameraMoveChange: (move: StageCameraMove) => void
}

const SPEED_OPTIONS: Array<{ label: string; value: StageSpeedPreset }> = [
  { label: '匀速', value: 'uniform' },
  { label: '平滑', value: 'easeInOut' },
  { label: '快速起步', value: 'fastStart' },
  { label: '缓慢起步', value: 'slowStart' },
]

const CAMERA_MOVE_OPTIONS: Array<{ label: string; value: StageCameraMove['kind'] }> = [
  { label: '直线', value: 'direct' }, { label: '环绕', value: 'orbit' },
  { label: '推进', value: 'dollyIn' }, { label: '拉远', value: 'dollyOut' },
  { label: '横移', value: 'truck' }, { label: '升降', value: 'crane' },
]

const MOTION_OPTIONS = [
  { label: '自动（推荐）', value: 'auto' }, { label: '无动作', value: 'pose' },
  ...CHARACTER_ANIMATION_CLIPS.map((clip) => ({ label: clip.label, value: clip.clipName })),
]

function defaultCameraMove(kind: StageCameraMove['kind']): StageCameraMove {
  if (kind === 'orbit') return { kind, degrees: STAGE_CAMERA_MOVE_DEFAULTS.orbitDegrees, direction: STAGE_CAMERA_MOVE_DEFAULTS.orbitDirection }
  if (kind === 'dollyIn') return { kind, distanceRatio: STAGE_CAMERA_MOVE_DEFAULTS.dollyInRatio }
  if (kind === 'dollyOut') return { kind, distanceRatio: STAGE_CAMERA_MOVE_DEFAULTS.dollyOutRatio }
  if (kind === 'truck') return { kind, offset: STAGE_CAMERA_MOVE_DEFAULTS.truckOffset }
  if (kind === 'crane') return { kind, height: STAGE_CAMERA_MOVE_DEFAULTS.craneHeight }
  return { kind: 'direct' }
}

const TransitionObjectRow: React.FC<TransitionObjectRowProps> = ({
  object,
  fromPosition,
  toPosition,
  detail,
  cameraMove,
  onDetailChange,
  onCameraMoveChange,
}) => {
  const Icon = object.type === 'camera' ? Camera : object.type === 'character' ? UserRound : Cuboid
  const move = cameraMove ?? { kind: 'direct' }
  const motionValue = detail.motionOverride?.mode === 'clip' ? detail.motionOverride.clipName : detail.motionOverride ? 'pose' : 'auto'
  const numberField = (label: string, value: number, onChange: (value: number) => void): React.ReactNode => (
    <label className="flex min-w-24 flex-col gap-1 text-[11px] text-text-muted">{label}
      <UiInput type="number" step={0.1} value={value} className="h-8 px-2 text-xs" onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )

  return (
    <div className="rounded-lg border border-border-dark bg-surface-dark p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-32 items-center gap-2 self-center text-xs text-text-dark"><Icon size={14} />{object.name}</div>
        <Dropdown label="速度" value={detail.speedPreset ?? 'easeInOut'} options={SPEED_OPTIONS}
          onSelect={(speedPreset) => onDetailChange({ ...detail, speedPreset })} buttonClassName="w-28" />
        <Dropdown
          label="空间路径"
          value={detail.spatialPath ? 'bezier' : 'linear'}
          options={[{ label: '直线', value: 'linear' }, { label: '贝塞尔', value: 'bezier' }]}
          onSelect={(kind) => onDetailChange({
            ...detail,
            spatialPath: kind === 'bezier' ? defaultSpatialPath(fromPosition, toPosition) : undefined,
          })}
          buttonClassName="w-24"
        />
        {numberField('延迟（秒）', detail.delay ?? 0, (delay) => onDetailChange({ ...detail, delay }))}
        {object.type === 'camera' && <Dropdown label="运镜" value={move.kind} options={CAMERA_MOVE_OPTIONS}
          onSelect={(kind) => onCameraMoveChange(defaultCameraMove(kind))} buttonClassName="w-24" />}
        {object.type === 'character' && <Dropdown label="过渡动作" value={motionValue} options={MOTION_OPTIONS}
          onSelect={(value) => onDetailChange({ ...detail, motionOverride: value === 'auto'
            ? undefined
            : value === 'pose' || !isCharacterAnimationClipName(value) ? createPoseMotion() : createClipMotion(value) })}
          buttonClassName="w-36" panelWidthStrategy="options" />}
      </div>
      {object.type === 'camera' && move.kind !== 'direct' && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border-dark pt-3">
          {move.kind === 'orbit' && <>
            {numberField('环绕角度', move.degrees, (degrees) => onCameraMoveChange({ ...move, degrees }))}
            <div className="flex flex-col gap-1 text-[11px] text-text-muted">方向<div className="flex gap-1">
              <UiOptionButton active={move.direction === 'cw'} className="h-8 px-3 text-xs" onClick={() => onCameraMoveChange({ ...move, direction: 'cw' })}>顺时针</UiOptionButton>
              <UiOptionButton active={move.direction === 'ccw'} className="h-8 px-3 text-xs" onClick={() => onCameraMoveChange({ ...move, direction: 'ccw' })}>逆时针</UiOptionButton>
            </div></div>
          </>}
          {(move.kind === 'dollyIn' || move.kind === 'dollyOut') && numberField('距离比例', move.distanceRatio, (distanceRatio) => onCameraMoveChange({ ...move, distanceRatio }))}
          {move.kind === 'truck' && numberField('横移距离', move.offset, (offset) => onCameraMoveChange({ ...move, offset }))}
          {move.kind === 'crane' && numberField('升降高度', move.height, (height) => onCameraMoveChange({ ...move, height }))}
          <span className="max-w-lg text-[11px] leading-5 text-text-muted">启用运镜预设后，终点机位由预设参数自动计算，与下一片段的摆放位置无关。</span>
        </div>
      )}
    </div>
  )
}

export default TransitionObjectRow
