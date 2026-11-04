import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { AnimationMixer, Bone, Euler, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { getBodyVariant } from '../domain/bodyVariants'
import { DEFAULT_CHARACTER_MOTION } from '../domain/characterMotion'
import { resolveCharacterMotionLayers } from '../domain/characterMotionTimeline'
import { POSE_JOINT_BONES } from '../domain/poseTypes'
import type { StagePoseJointId } from '../domain/poseTypes'
import { poseJointPath } from '../domain/animatableProps'
import { useCameraStageStore } from '../store/cameraStageStore'
import { registerPlaybackApplier } from '../store/playbackAppliers'
import type { StageCharacterObject, StageVec3 } from '../domain/sceneTypes'
import {
  readCameraStagePlaybackRuntime,
  subscribeCameraStagePlaybackRuntime,
} from './playbackRuntime'
import { CharacterClipPlaybackController } from './characterClipPlayback'

/**
 * 角色骨骼模型渲染：加载内置 GLB（骨架 + 蒙皮网格），按对象数据应用
 * FK 姿态（bone.quaternion = 绑定姿态 * 欧拉偏移）、体型变体缩放和纯色材质。
 * 每个角色实例用 SkeletonUtils.clone 克隆独立骨架，多角色姿态互不干扰。
 */

const DEG2RAD = Math.PI / 180
const HEAD_BONE_NAME = 'Head'
const FK_JOINT_BY_BONE = new Map(Object.entries(POSE_JOINT_BONES).map(([jointId, boneName]) => [boneName, jointId as StagePoseJointId]))

interface CharacterRig {
  scene: Group
  bones: Map<string, Bone>
  /** 骨骼绑定姿态的局部旋转，是姿态欧拉偏移的基准 */
  restQuaternions: Map<string, Quaternion>
  pelvisRestPosition: Vector3
}

interface CharacterModelProps {
  object: StageCharacterObject
  selected: boolean
  url: string
}

function buildRig(source: Group): CharacterRig {
  const scene = SkeletonUtils.clone(source) as Group
  const bones = new Map<string, Bone>()
  const restQuaternions = new Map<string, Quaternion>()

  scene.traverse((node) => {
    if ((node as Bone).isBone) {
      const bone = node as Bone
      bones.set(bone.name, bone)
      restQuaternions.set(bone.name, bone.quaternion.clone())
    }
    if ((node as Mesh).isMesh) {
      // 骨骼把网格带出绑定姿态包围盒后会被视锥体裁剪误杀，蒙皮网格统一关闭
      node.frustumCulled = false
    }
  })

  const pelvisBone = bones.get(POSE_JOINT_BONES.body)
  return {
    scene,
    bones,
    restQuaternions,
    pelvisRestPosition: pelvisBone ? pelvisBone.position.clone() : new Vector3(),
  }
}

const CharacterModel: React.FC<CharacterModelProps> = ({ object, selected, url }) => {
  const gltf = useGLTF(url)
  const invalidate = useThree((state) => state.invalidate)
  const rig = useMemo(() => buildRig(gltf.scene as Group), [gltf.scene])
  const mixer = useMemo(() => new AnimationMixer(rig.scene), [rig])
  const material = useMemo(() => new MeshStandardMaterial(), [])
  const motionTimeline = useCameraStageStore((state) => state.animation.characterMotions.find((timeline) => timeline.objectId === object.id))
  const clipController = useMemo(
    () => new CharacterClipPlaybackController(mixer, rig.scene, gltf.animations),
    [gltf.animations, mixer, rig.scene],
  )
  const clipDrivenRef = useRef(false)

  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => {
    clipController.dispose()
    mixer.uncacheRoot(rig.scene)
  }, [clipController, mixer, rig.scene])

  // 纯色材质覆盖：GLB 自带材质替换为单一颜色（对齐一期"纯色渲染"美术方向）
  useEffect(() => {
    rig.scene.traverse((node) => {
      if ((node as Mesh).isMesh) {
        const mesh = node as Mesh
        mesh.material = material
      }
    })
  }, [rig, material])

  useEffect(() => {
    material.color.set(object.color)
    material.emissive.set(object.color)
    material.emissiveIntensity = selected ? 0.35 : 0
  }, [material, object.color, selected])

  /**
   * 把骨骼写成（或按 weight 混向）FK 姿态。weight=1 直接写入；小于 1 时骨骼已由片段驱动，
   * 再向姿态插值，片段与姿态之间的切换因此也是交叉淡入淡出。未受控的骨骼姿态里就是绑定姿态。
   */
  const applyFkPose = useCallback((weight = 1) => {
    const euler = new Euler()
    const offset = new Quaternion()
    const target = new Quaternion()
    for (const [boneName, bone] of rig.bones) {
      const rest = rig.restQuaternions.get(boneName)
      if (!rest) continue
      const jointId = FK_JOINT_BY_BONE.get(boneName)
      const pose = jointId ? object.pose.joints[jointId] : undefined
      target.copy(rest)
      if (pose) {
        euler.set(pose.x * DEG2RAD, pose.y * DEG2RAD, pose.z * DEG2RAD, 'XYZ')
        offset.setFromEuler(euler)
        target.multiply(offset)
      }
      if (weight >= 1) bone.quaternion.copy(target)
      else bone.quaternion.slerp(target, weight)
    }

    const pelvis = rig.bones.get(POSE_JOINT_BONES.body)
    if (pelvis) {
      const { hipsOffset } = object.pose
      const position = rig.pelvisRestPosition.clone().add(hipsOffset ? new Vector3(hipsOffset.x, hipsOffset.y, hipsOffset.z) : new Vector3())
      if (weight >= 1) pelvis.position.copy(position)
      else pelvis.position.lerp(position, weight)
    }
  }, [object.pose, rig])

  // 同一 runtime 通知内决定各动作层并推进 mixer；先于本帧轨道 applier，边界不会晚 50ms。
  useEffect(() => {
    let initialized = false
    const applyAt = (time: number): void => {
      const layers = resolveCharacterMotionLayers(motionTimeline, time, object.motion ?? DEFAULT_CHARACTER_MOTION)
      const wasClipDriven = clipDrivenRef.current
      const poseWeight = clipController.apply(layers)
      clipDrivenRef.current = poseWeight < 1
      // 完全是姿态时，FK 静态姿态只在首次或片段→姿态边界恢复；逐帧 FK 动画继续由下方 applier 写骨骼。
      if (clipDrivenRef.current) {
        if (poseWeight > 0) applyFkPose(poseWeight)
      } else if (!initialized || wasClipDriven) {
        applyFkPose()
      }
      initialized = true
    }
    applyAt(readCameraStagePlaybackRuntime().time)
    return subscribeCameraStagePlaybackRuntime((runtime) => applyAt(runtime.time))
  }, [applyFkPose, clipController, motionTimeline, object.motion])

  // 播放期命令式采样：clip 生效时骨骼只由 mixer 驱动，避免与关节关键帧采样双写。
  useEffect(() => {
    const euler = new Euler()
    const quat = new Quaternion()
    const unregs = (Object.keys(POSE_JOINT_BONES) as StagePoseJointId[]).map(
      (jointId) =>
        registerPlaybackApplier(object.id, poseJointPath(jointId), (value) => {
          if (clipDrivenRef.current) return
          const bone = rig.bones.get(POSE_JOINT_BONES[jointId])
          const rest = rig.restQuaternions.get(POSE_JOINT_BONES[jointId])
          if (!bone || !rest) return
          const v = value as StageVec3
          euler.set(v.x * DEG2RAD, v.y * DEG2RAD, v.z * DEG2RAD, 'XYZ')
          quat.setFromEuler(euler)
          bone.quaternion.copy(rest).multiply(quat)
        }),
    )
    return () => unregs.forEach((unregister) => unregister())
  }, [object.id, rig])

  // 颜色关键帧不与 mixer 冲突，始终注册，避免切换动作时颜色动画失效。
  useEffect(() => registerPlaybackApplier(object.id, 'color', (value) => {
    material.color.set(value as string)
    material.emissive.set(value as string)
  }), [object.id, material])

  // 体型变体：头部骨骼缩放（头身比），整体缩放走容器 group
  const variant = getBodyVariant(object.variant)
  useEffect(() => {
    const head = rig.bones.get(HEAD_BONE_NAME)
    head?.scale.setScalar(variant.headScale)
  }, [rig, variant])

  // 上面的 effect 直接改材质与骨骼，不经过 R3F 属性；按需渲染下每次提交后补一帧，模型异步加载完成时也靠这一帧显示
  useEffect(() => { invalidate() })

  return (
    <group scale={[variant.bodyScale.x, variant.bodyScale.y, variant.bodyScale.z]}>
      <primitive object={rig.scene} />
    </group>
  )
}

export default CharacterModel
