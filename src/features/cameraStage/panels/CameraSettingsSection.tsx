import React, { useState } from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, UiFormRow, UiGroup } from '@/components/ui'
import {
  cameraTargetFromRotation,
  getObjectLookAtPoint,
  isFirstCamera,
  resolveCameraLookAtTarget,
  resolveCameraRotation,
} from '../domain/cameraUtils'
import { focalLengthToFov, fovToFocalLength } from '../domain/cameraOptics'
import { CAMERA_ASPECT_RATIO_PRESETS } from '../domain/sceneDefaults'
import type {
  StageCameraAspectRatioPreset,
  StageCameraLookAt,
  StageCameraObject,
  StageVec3,
} from '../domain/sceneTypes'
import type { StageCameraEffector } from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { SliderNumberRow, SwitchRow, Vec3Row } from './panelFields'

type LookAtMode = StageCameraLookAt['mode']

const LOOK_AT_MODE_OPTIONS: Array<{ label: string; value: LookAtMode; disabled?: boolean }> = [
  { label: '手动坐标', value: 'manual' },
  { label: '锁定对象', value: 'object' },
]

const CUSTOM_ASPECT_RATIO_INITIAL_HEIGHT = 9
const EFFECTOR_DEFAULTS: Record<StageCameraEffector['kind'], Omit<StageCameraEffector, 'id' | 'kind'>> = {
  handheld: { enabled: false, intensity: 1, frequency: 1.4 },
  breathing: { enabled: false, intensity: 1, frequency: 0.25 },
}

/** 自定义画幅比例的宽/高输入：用 key={cameraId} 挂载重置，避免切换摄像机后残留上一台的编辑态 */
const CustomAspectRatioInputs: React.FC<{ ratio: number; onChange: (ratio: number) => void }> = ({
  ratio,
  onChange,
}) => {
  const [width, setWidth] = useState(Math.max(1, Math.round(ratio * CUSTOM_ASPECT_RATIO_INITIAL_HEIGHT)))
  const [height, setHeight] = useState(CUSTOM_ASPECT_RATIO_INITIAL_HEIGHT)

  const commit = (nextWidth: number, nextHeight: number): void => {
    if (nextWidth > 0 && nextHeight > 0) onChange(nextWidth / nextHeight)
  }

  return (
    <div className="flex items-center gap-1.5">
      <NumberInput
        ariaLabel="画幅宽"
        size="sm"
        value={width}
        min={1}
        precision={0}
        widthClassName="w-16"
        commitOnChange
        wheelStep
        onChange={(next) => {
          setWidth(next)
          commit(next, height)
        }}
      />
      <span aria-hidden="true" className="text-xs text-text3">:</span>
      <NumberInput
        ariaLabel="画幅高"
        size="sm"
        value={height}
        min={1}
        precision={0}
        widthClassName="w-16"
        commitOnChange
        wheelStep
        onChange={(next) => {
          setHeight(next)
          commit(width, next)
        }}
      />
    </div>
  )
}

function getLookAtModeDisplay(mode: LookAtMode): string {
  return mode === 'manual' ? '手动坐标' : '锁定对象'
}

function createManualLookAt(target: StageVec3): StageCameraLookAt {
  return { mode: 'manual', target: { ...target } }
}

function createObjectLookAt(objectId: string, fallbackTarget: StageVec3): StageCameraLookAt {
  return { mode: 'object', objectId, fallbackTarget: { ...fallbackTarget } }
}

const CameraSettingsSection: React.FC<{ object: StageCameraObject }> = ({ object }) => {
  const objects = useCameraStageStore((state) => state.objects)
  const updateObject = useCameraStageStore((state) => state.updateObject)
  const updateCameraView = useCameraStageStore((state) => state.updateCameraView)
  // 注视目标可锁定任意场景对象（角色/几何体/其他摄像机），只排除自己
  const lockableTargets = objects.filter((item) => item.id !== object.id)
  const resolvedTarget = resolveCameraLookAtTarget(object, objects)
  const cameraRotation = resolveCameraRotation(object, objects)
  const focalLength = fovToFocalLength(object.fov)
  // 重要记录 007：画幅一致性只由首个摄像机决定，非首摄像机画幅字段只读
  const isPrimaryCamera = isFirstCamera(objects, object.id)
  const lookAt = object.lookAt
  const selectedTarget = lookAt.mode === 'object'
    ? lockableTargets.find((item) => item.id === lookAt.objectId)
    : undefined

  const handleModeSelect = (mode: LookAtMode): void => {
    if (mode === object.lookAt.mode) return
    if (mode === 'manual') {
      updateObject(object.id, { lookAt: createManualLookAt(resolvedTarget) })
      return
    }
    const firstTarget = lockableTargets[0]
    if (!firstTarget) {
      updateObject(object.id, { lookAt: createManualLookAt(resolvedTarget) })
      return
    }
    updateObject(object.id, {
      lookAt: createObjectLookAt(firstTarget.id, getObjectLookAtPoint(firstTarget)),
    })
  }

  const handleTargetSelect = (targetId: string): void => {
    const target = lockableTargets.find((item) => item.id === targetId)
    updateObject(object.id, {
      lookAt: createObjectLookAt(targetId, target ? getObjectLookAtPoint(target) : resolvedTarget),
    })
  }

  const handleManualTargetChange = (target: StageVec3): void => {
    updateObject(object.id, { lookAt: createManualLookAt(target) })
  }

  const handleRotationChange = (rotation: StageVec3): void => {
    updateCameraView(object.id, {
      rotation,
      lookAtTarget: cameraTargetFromRotation(object, objects, rotation),
    })
  }

  const handleFocalLengthChange = (next: number): void => {
    updateObject(object.id, { fov: focalLengthToFov(next) })
  }

  const handleAspectPresetSelect = (preset: StageCameraAspectRatioPreset): void => {
    const found = CAMERA_ASPECT_RATIO_PRESETS.find((item) => item.value === preset)
    if (!found) return
    updateObject(object.id, { aspectRatio: { preset, ratio: found.ratio ?? object.aspectRatio.ratio } })
  }

  const handleCustomRatioChange = (ratio: number): void => {
    updateObject(object.id, { aspectRatio: { preset: 'custom', ratio } })
  }

  const aspectPresetLabel =
    CAMERA_ASPECT_RATIO_PRESETS.find((item) => item.value === object.aspectRatio.preset)?.label ?? '自定义'

  const updateEffector = (kind: StageCameraEffector['kind'], patch: Partial<StageCameraEffector>): void => {
    const current = object.effectors.find((effector) => effector.kind === kind)
    const next: StageCameraEffector = current
      ? { ...current, ...patch }
      : { id: `camera-${kind}`, kind, ...EFFECTOR_DEFAULTS[kind], ...patch }
    updateObject(object.id, {
      effectors: [...object.effectors.filter((effector) => effector.kind !== kind), next],
    })
  }

  const renderEffector = (kind: StageCameraEffector['kind'], label: string): React.ReactNode => {
    const effector = object.effectors.find((item) => item.kind === kind)
    const value = effector ?? { id: `camera-${kind}`, kind, ...EFFECTOR_DEFAULTS[kind] }
    return (
      <>
        <SwitchRow label={label} checked={value.enabled} onChange={(enabled) => updateEffector(kind, { enabled })} />
        {value.enabled && (
          <>
            <SliderNumberRow label="强度" ariaLabel={`${label}强度`} min={0} max={2} step={0.05} precision={2}
              value={value.intensity} onChange={(intensity) => updateEffector(kind, { intensity })} />
            <SliderNumberRow label="频率" ariaLabel={`${label}频率`} min={0.05} max={3} step={0.05} precision={2}
              value={value.frequency} onChange={(frequency) => updateEffector(kind, { frequency })} />
          </>
        )}
      </>
    )
  }

  return (
    <>
      <UiGroup title="相机" titleTone="compact" divided>
        <Vec3Row
          label="旋转（°）"
          name="旋转"
          value={cameraRotation}
          step={0.1}
          precision={2}
          onAxisChange={(axis, next) => handleRotationChange({ ...cameraRotation, [axis]: next })}
        />
        <SliderNumberRow
          label="焦距（mm）"
          info="按全画幅等效焦距计算：数值越小视野越广，越大越像长焦特写。"
          ariaLabel="焦距"
          min={10}
          max={200}
          step={1}
          precision={0}
          value={focalLength}
          onChange={handleFocalLengthChange}
        />
        <UiFormRow
          label="画幅比例"
          density="compact"
          hint={isPrimaryCamera ? undefined : '画幅由首个摄像机决定，如需更改请编辑首个摄像机'}
        >
          <div className="flex items-center gap-1.5">
            <Dropdown<StageCameraAspectRatioPreset>
              ariaLabel="画幅比例"
              value={object.aspectRatio.preset}
              display={aspectPresetLabel}
              options={CAMERA_ASPECT_RATIO_PRESETS.map((item) => ({ label: item.label, value: item.value }))}
              onSelect={handleAspectPresetSelect}
              className="min-w-0 flex-1"
              size="sm"
              minWidthStrategy="none"
              disabled={!isPrimaryCamera}
            />
            {isPrimaryCamera && object.aspectRatio.preset === 'custom' && (
              <CustomAspectRatioInputs
                key={object.id}
                ratio={object.aspectRatio.ratio}
                onChange={handleCustomRatioChange}
              />
            )}
          </div>
        </UiFormRow>
        <UiFormRow label="注视目标" density="compact">
          <Dropdown<LookAtMode>
            ariaLabel="注视目标"
            value={object.lookAt.mode}
            display={getLookAtModeDisplay(object.lookAt.mode)}
            options={LOOK_AT_MODE_OPTIONS.map((option) => ({
              ...option,
              disabled: option.value === 'object' && lockableTargets.length === 0,
            }))}
            onSelect={handleModeSelect}
            className="w-full"
            size="sm"
            minWidthStrategy="none"
          />
        </UiFormRow>
        {lookAt.mode === 'manual' ? (
          <Vec3Row
            label="目标坐标"
            name="目标坐标"
            value={lookAt.target}
            step={0.1}
            precision={2}
            onAxisChange={(axis, next) => handleManualTargetChange({ ...lookAt.target, [axis]: next })}
          />
        ) : (
          <UiFormRow label="锁定对象" density="compact">
            <Dropdown<string>
              ariaLabel="锁定对象"
              value={selectedTarget?.id}
              display={selectedTarget?.name ?? '选择对象'}
              options={lockableTargets.map((target) => ({ label: target.name, value: target.id }))}
              onSelect={handleTargetSelect}
              className="w-full"
              size="sm"
              minWidthStrategy="none"
            />
          </UiFormRow>
        )}
      </UiGroup>

      <UiGroup title="效果器" titleTone="compact" divided>
        {renderEffector('handheld', '手持晃动')}
        {renderEffector('breathing', '呼吸推拉')}
      </UiGroup>
    </>
  )
}

export default CameraSettingsSection
