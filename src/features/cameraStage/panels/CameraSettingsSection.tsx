import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, UiButton, UiRangeInput } from '@/components/ui'
import { getObjectLookAtPoint, resolveCameraLookAtTarget } from '../domain/cameraUtils'
import type { StageCameraLookAt, StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

type LookAtMode = StageCameraLookAt['mode']

const AXES: Array<keyof StageVec3> = ['x', 'y', 'z']
const LOOK_AT_MODE_OPTIONS: Array<{ label: string; value: LookAtMode; disabled?: boolean }> = [
  { label: '手动坐标', value: 'manual' },
  { label: '锁定角色', value: 'object' },
]

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
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const updateObject = useCameraStageStore((state) => state.updateObject)
  const setActiveCameraId = useCameraStageStore((state) => state.setActiveCameraId)
  const setViewMode = useCameraStageStore((state) => state.setViewMode)
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

  const handleUseAsViewport = (): void => {
    setActiveCameraId(object.id)
    setViewMode('camera')
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>相机</SectionTitle>
      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-text-muted">取景机位</div>
        <UiButton
          size="sm"
          disabled={activeCameraId === object.id}
          onClick={handleUseAsViewport}
        >
          {activeCameraId === object.id ? '当前取景机位' : '设为取景机位'}
        </UiButton>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-text-muted">视野角 FOV（°）</div>
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
    </div>
  )
}

export default CameraSettingsSection
