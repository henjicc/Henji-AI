import React, { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { AnimationMixer, Bone, Euler, Group, LoopRepeat, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { getBodyVariant } from '../domain/bodyVariants'
import { DEFAULT_CHARACTER_MOTION } from '../domain/characterMotion'
import { POSE_JOINT_BONES } from '../domain/poseTypes'
import type { StagePoseJointId } from '../domain/poseTypes'
import { poseJointPath } from '../domain/animatableProps'
import { useCameraStageStore } from '../store/cameraStageStore'
import { registerPlaybackApplier } from '../store/playbackAppliers'
import type { StageCharacterObject, StageVec3 } from '../domain/sceneTypes'

/**
 * 角色骨骼模型渲染：加载内置 GLB（骨架 + 蒙皮网格），按对象数据应用
 * FK 姿态（bone.quaternion = 绑定姿态 * 欧拉偏移）、体型变体缩放和纯色材质。
 * 每个角色实例用 SkeletonUtils.clone 克隆独立骨架，多角色姿态互不干扰。
 */

const DEG2RAD = Math.PI / 180
const HEAD_BONE_NAME = 'Head'

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
  const rig = useMemo(() => buildRig(gltf.scene as Group), [gltf.scene])
  const mixer = useMemo(() => new AnimationMixer(rig.scene), [rig])
  const material = useMemo(() => new MeshStandardMaterial(), [])
  const motion = object.motion ?? DEFAULT_CHARACTER_MOTION
  const activeClip = useMemo(() => {
    if (motion.mode !== 'clip') return null
    return gltf.animations.find((clip) => clip.name === motion.clipName) ?? null
  }, [gltf.animations, motion])

  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => mixer.uncacheRoot(rig.scene), [mixer, rig.scene])

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

  // FK 姿态应用：受控关节 = 绑定姿态 × 欧拉偏移；未记录的关节回到绑定姿态
  useEffect(() => {
    if (motion.mode === 'clip' && activeClip) return
    const euler = new Euler()
    const offset = new Quaternion()
    for (const [jointId, boneName] of Object.entries(POSE_JOINT_BONES)) {
      const bone = rig.bones.get(boneName)
      const rest = rig.restQuaternions.get(boneName)
      if (!bone || !rest) continue
      const pose = object.pose.joints[jointId as StagePoseJointId]
      if (pose) {
        euler.set(pose.x * DEG2RAD, pose.y * DEG2RAD, pose.z * DEG2RAD, 'XYZ')
        offset.setFromEuler(euler)
        bone.quaternion.copy(rest).multiply(offset)
      } else {
        bone.quaternion.copy(rest)
      }
    }

    const pelvis = rig.bones.get(POSE_JOINT_BONES.body)
    if (pelvis) {
      const { hipsOffset } = object.pose
      pelvis.position
        .copy(rig.pelvisRestPosition)
        .add(hipsOffset ? new Vector3(hipsOffset.x, hipsOffset.y, hipsOffset.z) : new Vector3())
    }
  }, [activeClip, rig, object.pose, motion.mode])

  // 仅在片段本身变化时重建 action；播放位置和速度统一由时间轴驱动，避免速度调整时重播。
  useEffect(() => {
    mixer.stopAllAction()
    if (!activeClip) return undefined

    const action = mixer.clipAction(activeClip, rig.scene)
    action.reset()
    action.setLoop(LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.enabled = true
    action.play()
    mixer.update(0)

    return () => {
      action.stop()
    }
  }, [activeClip, mixer, rig.scene])

  useFrame(() => {
    if (motion.mode === 'clip' && activeClip) {
      const { currentTime } = useCameraStageStore.getState().playback
      mixer.setTime(currentTime * motion.speed)
    }
  })

  // 播放期命令式采样：逐关节欧拉偏移直改骨骼、颜色直改共享材质（不写 store）
  useEffect(() => {
    const euler = new Euler()
    const quat = new Quaternion()
    const unregs: Array<() => void> = (Object.keys(POSE_JOINT_BONES) as StagePoseJointId[]).map(
      (jointId) =>
        registerPlaybackApplier(object.id, poseJointPath(jointId), (value) => {
          const bone = rig.bones.get(POSE_JOINT_BONES[jointId])
          const rest = rig.restQuaternions.get(POSE_JOINT_BONES[jointId])
          if (!bone || !rest) return
          const v = value as StageVec3
          euler.set(v.x * DEG2RAD, v.y * DEG2RAD, v.z * DEG2RAD, 'XYZ')
          quat.setFromEuler(euler)
          bone.quaternion.copy(rest).multiply(quat)
        }),
    )
    unregs.push(
      registerPlaybackApplier(object.id, 'color', (value) => {
        material.color.set(value as string)
        material.emissive.set(value as string)
      }),
    )
    return () => unregs.forEach((unregister) => unregister())
  }, [object.id, rig, material])

  // 体型变体：头部骨骼缩放（头身比），整体缩放走容器 group
  const variant = getBodyVariant(object.variant)
  useEffect(() => {
    const head = rig.bones.get(HEAD_BONE_NAME)
    head?.scale.setScalar(variant.headScale)
  }, [rig, variant])

  return (
    <group scale={[variant.bodyScale.x, variant.bodyScale.y, variant.bodyScale.z]}>
      <primitive object={rig.scene} />
    </group>
  )
}

export default CharacterModel
