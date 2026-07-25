import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, UiButton, UiOptionButton, UiRangeInput } from '@/components/ui'
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
import KeyframeStopwatch from '../timeline/KeyframeStopwatch'

/**
 * 角色专属属性区：体型变体切换、预设姿势一键应用、FK 逐关节欧拉滑杆。
 * 滑杆分组对齐参考产品（身体/躯干/头部/左右臂/左右腿），分组手风琴展开。
 */

const AXES: Array<keyof StageVec3> = ['x', 'y', 'z']
const AXIS_LABELS: Record<keyof StageVec3, string> = { x: 'X', y: 'Y', z: 'Z' }
const ZERO_EULER: StageVec3 = { x: 0, y: 0, z: 0 }
type CharacterMotionValue = typeof CHARACTER_POSE_MOTION_VALUE | StageCharacterAnimationClipName

const MOTION_OPTIONS: Array<{ label: string; value: CharacterMotionValue }> = [
  { label: '静态姿势', value: CHARACTER_POSE_MOTION_VALUE },
  ...CHARACTER_ANIMATION_CLIPS.map((clip) => ({ label: clip.label, value: clip.clipName })),
]

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{children}</div>
)

interface JointSlidersProps {
  jointName: string
  value: StageVec3
  objectId: string
  jointId: StagePoseJointId
  onChange: (next: StageVec3, changedPath: string) => void
}

const JointSliders: React.FC<JointSlidersProps> = ({ jointName, value, objectId, jointId, onChange }) => {
  const basePath = poseJointPath(jointId)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <KeyframeStopwatch objectId={objectId} groupPath={basePath} />
        <span>{jointName}</span>
      </div>
      {AXES.map((axis) => {
        const path = `${basePath}.${axis}`
        return (
          <div key={axis} className="flex items-center gap-1.5">
            <KeyframeStopwatch objectId={objectId} path={path} className="h-4 w-4" />
            <span className="w-3 shrink-0 text-center text-2xs text-text-muted">{AXIS_LABELS[axis]}</span>
            <UiRangeInput
              min={-180}
              max={180}
              step={1}
              value={value[axis]}
              onChange={(event) => onChange({ ...value, [axis]: Number(event.target.value) }, path)}
            />
            <NumberInput
              value={value[axis]}
              min={-180}
              max={180}
              step={1}
              precision={0}
              widthClassName="w-14"
              className="shrink-0"
              commitOnChange
              wheelStep
              onChange={(next) => onChange({ ...value, [axis]: next }, path)}
            />
          </div>
        )
      })}
    </div>
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
      <div className="flex flex-col gap-2">
        <SectionTitle>动作</SectionTitle>
        <Dropdown<CharacterMotionValue>
          value={motionValue}
          display={motionDisplay}
          options={MOTION_OPTIONS}
          onSelect={handleMotionSelect}
          className="w-full"
          minWidthStrategy="none"
        />
        {motion.mode === 'clip' && (
          <div className="flex items-center gap-1.5">
            <UiRangeInput
              min={0.1}
              max={3}
              step={0.05}
              value={motion.speed}
              onChange={(event) => handleMotionSpeedChange(Number(event.target.value))}
            />
            <NumberInput
              value={motion.speed}
              min={0.1}
              max={3}
              step={0.05}
              precision={2}
              widthClassName="w-16"
              className="shrink-0"
              commitOnChange
              wheelStep
              onChange={handleMotionSpeedChange}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>体型</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {BODY_VARIANTS.map((variant) => (
            <UiOptionButton
              key={variant.id}
              active={object.variant === variant.id}
              onClick={() => updateObject(object.id, { variant: variant.id })}
              className="py-1 text-xs"
            >
              {variant.name}
            </UiOptionButton>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>预设姿势</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {POSE_PRESETS.map((preset) => (
            <UiButton
              key={preset.id}
              size="sm"
              onClick={() => applyPosePreset(object.id, preset)}
            >
              {preset.name}
            </UiButton>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>姿态调节</SectionTitle>
        <div className="flex flex-col gap-1">
          {POSE_JOINT_GROUPS.map((group) => {
            const open = openGroupId === group.id
            return (
              <div key={group.id} className="flex flex-col gap-2">
                <UiButton
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => setOpenGroupId(open ? null : group.id)}
                >
                  <span>{group.name}</span>
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </UiButton>
                {open && (
                  <div className="flex flex-col gap-2.5 px-1 pb-1.5">
                    {group.joints.map((joint) => (
                      <JointSliders
                        key={joint.id}
                        jointName={joint.name}
                        objectId={object.id}
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
        </div>
      </div>
    </>
  )
}

export default CharacterPoseSection
