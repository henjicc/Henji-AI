import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, UI_SEGMENTED_TRACK_CLASS, UiButton, UiFormRow, UiGroup, UiOptionButton, UiRangeInput } from '@/components/ui'
import { BODY_VARIANTS } from '../domain/bodyVariants'
import {
  CHARACTER_ANIMATION_CLIPS,
  CHARACTER_POSE_MOTION_VALUE,
  createClipMotion,
  createPoseMotion,
  getCharacterMotionClipLabel,
} from '../domain/characterMotion'
import type { StageCharacterAnimationClipName } from '../domain/characterMotion'
import { POSE_JOINT_GROUPS } from '../domain/poseTypes'
import { POSE_PRESETS } from '../domain/posePresets.gen'
import type { StagePoseJointId } from '../domain/poseTypes'
import type { StageCharacterObject, StageVec3 } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { poseJointPath } from '../domain/animatableProps'
import { SliderNumberRow } from './panelFields'

/**
 * 角色专属属性区：体型变体切换、预设姿势一键应用、FK 逐关节欧拉滑杆。
 * 滑杆分组对齐参考产品（身体/躯干/头部/左右臂/左右腿），分组手风琴展开。
 * 体型是单选（分段），预设姿势是一组同档的次级动作。
 */

const AXES: Array<keyof StageVec3> = ['x', 'y', 'z']
const AXIS_LABELS: Record<keyof StageVec3, string> = { x: 'X', y: 'Y', z: 'Z' }
const ZERO_EULER: StageVec3 = { x: 0, y: 0, z: 0 }
type CharacterMotionValue = typeof CHARACTER_POSE_MOTION_VALUE | StageCharacterAnimationClipName

const MOTION_OPTIONS: Array<{ label: string; value: CharacterMotionValue }> = [
  { label: '静态姿势', value: CHARACTER_POSE_MOTION_VALUE },
  ...CHARACTER_ANIMATION_CLIPS.map((clip) => ({ label: clip.label, value: clip.clipName })),
]

interface JointSlidersProps {
  jointName: string
  value: StageVec3
  jointId: StagePoseJointId
  onChange: (next: StageVec3, changedPath: string) => void
}

/** 一个关节的三轴欧拉角：每轴一行“轴名 + 滑杆 + 数值框”。 */
const JointSliders: React.FC<JointSlidersProps> = ({ jointName, value, jointId, onChange }) => {
  const basePath = poseJointPath(jointId)
  return (
    <UiFormRow label={jointName} density="compact">
      <div className="flex flex-col gap-1">
        {AXES.map((axis) => {
          const path = `${basePath}.${axis}`
          const axisLabel = `${jointName} ${AXIS_LABELS[axis]}`
          return (
            <div key={axis} className="flex items-center gap-2">
              <span aria-hidden="true" className="w-3 shrink-0 text-center text-2xs text-text3">{AXIS_LABELS[axis]}</span>
              <UiRangeInput
                aria-label={axisLabel}
                min={-180}
                max={180}
                step={1}
                value={value[axis]}
                onChange={(event) => onChange({ ...value, [axis]: Number(event.target.value) }, path)}
              />
              <NumberInput
                ariaLabel={axisLabel}
                size="sm"
                value={value[axis]}
                min={-180}
                max={180}
                step={1}
                precision={0}
                widthClassName="w-14"
                align="right"
                className="shrink-0"
                commitOnChange
                wheelStep
                onChange={(next) => onChange({ ...value, [axis]: next }, path)}
              />
            </div>
          )
        })}
      </div>
    </UiFormRow>
  )
}

const CharacterPoseSection: React.FC<{ object: StageCharacterObject }> = ({ object }) => {
  const updateObject = useCameraStageStore((state) => state.updateObject)
  const updatePoseJoint = useCameraStageStore((state) => state.updatePoseJoint)
  const applyPosePreset = useCameraStageStore((state) => state.applyPosePreset)
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const motion = object.motion ?? createPoseMotion()
  const motionValue: CharacterMotionValue =
    motion.mode === 'clip' ? motion.clipName : CHARACTER_POSE_MOTION_VALUE
  const motionDisplay =
    motion.mode === 'clip' ? getCharacterMotionClipLabel(motion.clipName) : '静态姿势'

  const handleJointChange = (jointId: StagePoseJointId, next: StageVec3, changedPath: string): void => {
    updatePoseJoint(object.id, jointId, next, [changedPath])
  }

  const handleMotionSelect = (value: CharacterMotionValue): void => {
    updateObject(object.id, {
      motion:
        value === CHARACTER_POSE_MOTION_VALUE
          ? createPoseMotion()
          : createClipMotion(value, motion.mode === 'clip' ? motion.speed : 1),
    })
  }

  const handleMotionSpeedChange = (speed: number): void => {
    if (motion.mode !== 'clip') return
    updateObject(object.id, { motion: createClipMotion(motion.clipName, speed) })
  }

  return (
    <>
      <UiGroup title="角色" titleTone="compact" divided>
        <UiFormRow label="动作" density="compact">
          <Dropdown<CharacterMotionValue>
            ariaLabel="动作"
            value={motionValue}
            display={motionDisplay}
            options={MOTION_OPTIONS}
            onSelect={handleMotionSelect}
            className="w-full"
            size="sm"
            minWidthStrategy="none"
          />
        </UiFormRow>
        {motion.mode === 'clip' && (
          <SliderNumberRow
            label="动作速度"
            ariaLabel="动作速度"
            min={0.1}
            max={3}
            step={0.05}
            precision={2}
            value={motion.speed}
            onChange={handleMotionSpeedChange}
          />
        )}
        <UiFormRow label="体型" density="compact">
          <div role="radiogroup" aria-label="体型" className={`${UI_SEGMENTED_TRACK_CLASS} w-full`}>
            {BODY_VARIANTS.map((variant) => (
              <UiOptionButton
                key={variant.id}
                variant="segment"
                role="radio"
                aria-checked={object.variant === variant.id}
                active={object.variant === variant.id}
                className="flex-1"
                onClick={() => updateObject(object.id, { variant: variant.id })}
              >
                {variant.name}
              </UiOptionButton>
            ))}
          </div>
        </UiFormRow>
        <UiFormRow label="预设姿势" density="compact">
          <div className="flex flex-wrap gap-1.5">
            {POSE_PRESETS.map((preset) => (
              <UiButton
                key={preset.id}
                variant="secondary"
                size="sm"
                onClick={() => applyPosePreset(object.id, preset)}
              >
                {preset.name}
              </UiButton>
            ))}
          </div>
        </UiFormRow>
      </UiGroup>

      <UiGroup title="姿态调节" titleTone="compact" divided gap="none">
        {POSE_JOINT_GROUPS.map((group) => {
          const open = openGroupId === group.id
          return (
            <div key={group.id}>
              <UiButton
                size="sm"
                aria-expanded={open}
                className="w-full justify-between"
                onClick={() => setOpenGroupId(open ? null : group.id)}
              >
                <span>{group.name}</span>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </UiButton>
              {open && (
                <div className="flex flex-col gap-2.5 px-1 pb-2 pt-1">
                  {group.joints.map((joint) => (
                    <JointSliders
                      key={joint.id}
                      jointName={joint.name}
                      jointId={joint.id}
                      value={object.pose.joints[joint.id] ?? ZERO_EULER}
                      onChange={(next, changedPath) => handleJointChange(joint.id, next, changedPath)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </UiGroup>
    </>
  )
}

export default CharacterPoseSection
