import React, { useState } from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, UiRangeInput, UiSwitch } from '@/components/ui'
import { getObjectLookAtPoint, resolveCameraLookAtTarget } from '../domain/cameraUtils'
import { CAMERA_ASPECT_RATIO_PRESETS } from '../domain/sceneDefaults'
import type {
  StageCameraAspectRatioPreset,
  StageCameraLookAt,
  StageCameraObject,
  StageVec3,
} from '../domain/sceneTypes'
import type { StageCameraEffector } from '../domain/shotTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import KeyframeStopwatch from '../timeline/KeyframeStopwatch'

type LookAtMode = StageCameraLookAt['mode']

const AXES: Array<keyof StageVec3> = ['x', 'y', 'z']
const LOOK_AT_MODE_OPTIONS: Array<{ label: string; value: LookAtMode; disabled?: boolean }> = [
  { label: '手动坐标', value: 'manual' },
  { label: '锁定角色', value: 'object' },
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
      <span className="text-xs text-text-muted">:</span>
      <NumberInput
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

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{children}</div>
)

const Vec3NumberRow: React.FC<{
  label: string
  value: StageVec3
  onChange: (next: StageVec3) => void
}> = ({ label, value, onChange }) => (
  <div>
    <div className="mb-1 text-xs text-text-muted">{label}</div>
    <div className="flex gap-1.5">
      {AXES.map((axis) => (
        <NumberInput
          key={axis}
          value={value[axis]}
          step={0.1}
          precision={2}
          widthClassName="w-full"
          className="min-w-0 flex-1"
          commitOnChange
          wheelStep
          onChange={(next) => onChange({ ...value, [axis]: next })}
        />
      ))}
    </div>
  </div>
)

function getLookAtModeDisplay(mode: LookAtMode): string {
  return mode === 'manual' ? '手动坐标' : '锁定角色'
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
  const characters = objects.filter((item) => item.type === 'character')
  const resolvedTarget = resolveCameraLookAtTarget(object, objects)
  const lookAt = object.lookAt
  const selectedCharacter = lookAt.mode === 'object'
    ? characters.find((item) => item.id === lookAt.objectId)
    : undefined

  const handleModeSelect = (mode: LookAtMode): void => {
    if (mode === object.lookAt.mode) return
    if (mode === 'manual') {
      updateObject(object.id, { lookAt: createManualLookAt(resolvedTarget) })
      return
    }
    const firstCharacter = characters[0]
    if (!firstCharacter) {
      updateObject(object.id, { lookAt: createManualLookAt(resolvedTarget) })
      return
    }
    updateObject(object.id, {
      lookAt: createObjectLookAt(firstCharacter.id, getObjectLookAtPoint(firstCharacter)),
    })
  }

  const handleCharacterSelect = (characterId: string): void => {
    const character = characters.find((item) => item.id === characterId)
    updateObject(object.id, {
      lookAt: createObjectLookAt(characterId, character ? getObjectLookAtPoint(character) : resolvedTarget),
    })
  }

  const handleManualTargetChange = (target: StageVec3): void => {
    updateObject(object.id, { lookAt: createManualLookAt(target) })
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
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">{label}</span>
          <UiSwitch checked={value.enabled} onCheckedChange={(enabled) => updateEffector(kind, { enabled })} />
        </div>
        {value.enabled && (
          <>
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <span className="w-10 shrink-0">强度</span>
              <UiRangeInput min={0} max={2} step={0.05} value={value.intensity}
                onChange={(event) => updateEffector(kind, { intensity: Number(event.target.value) })} />
            </label>
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <span className="w-10 shrink-0">频率</span>
              <UiRangeInput min={0.05} max={3} step={0.05} value={value.frequency}
                onChange={(event) => updateEffector(kind, { frequency: Number(event.target.value) })} />
            </label>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>相机</SectionTitle>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <KeyframeStopwatch objectId={object.id} groupPath="fov" />
          <span>视野角 FOV（°）</span>
        </div>
        <div className="flex items-center gap-1.5">
          <UiRangeInput
            min={10}
            max={120}
            step={1}
            value={object.fov}
            onChange={(event) => updateObject(object.id, { fov: Number(event.target.value) })}
          />
          <NumberInput
            value={object.fov}
            step={1}
            min={10}
            max={120}
            precision={0}
            widthClassName="w-16"
            className="shrink-0"
            commitOnChange
            wheelStep
            onChange={(next) => updateObject(object.id, { fov: next })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-text-muted">画幅比例</div>
        <div className="flex items-center gap-1.5">
          <Dropdown<StageCameraAspectRatioPreset>
            value={object.aspectRatio.preset}
            display={aspectPresetLabel}
            options={CAMERA_ASPECT_RATIO_PRESETS.map((item) => ({ label: item.label, value: item.value }))}
            onSelect={handleAspectPresetSelect}
            className="w-full"
            minWidthStrategy="none"
          />
          {object.aspectRatio.preset === 'custom' && (
            <CustomAspectRatioInputs
              key={object.id}
              ratio={object.aspectRatio.ratio}
              onChange={handleCustomRatioChange}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-text-muted">注视目标</div>
        <Dropdown<LookAtMode>
          value={object.lookAt.mode}
          display={getLookAtModeDisplay(object.lookAt.mode)}
          options={LOOK_AT_MODE_OPTIONS.map((option) => ({
            ...option,
            disabled: option.value === 'object' && characters.length === 0,
          }))}
          onSelect={handleModeSelect}
          className="w-full"
          minWidthStrategy="none"
        />
      </div>

      {object.lookAt.mode === 'manual' ? (
        <Vec3NumberRow
          label="目标坐标"
          value={object.lookAt.target}
          onChange={handleManualTargetChange}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-text-muted">锁定角色</div>
          <Dropdown<string>
            value={selectedCharacter?.id}
            display={selectedCharacter?.name ?? '选择角色'}
            options={characters.map((character) => ({ label: character.name, value: character.id }))}
            onSelect={handleCharacterSelect}
            className="w-full"
            minWidthStrategy="none"
          />
        </div>
      )}

      <SectionTitle>效果器</SectionTitle>
      {renderEffector('handheld', '手持晃动')}
      {renderEffector('breathing', '呼吸推拉')}
    </div>
  )
}

export default CameraSettingsSection
