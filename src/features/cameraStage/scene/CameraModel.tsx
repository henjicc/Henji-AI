import React, { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Group, Mesh, MeshStandardMaterial } from 'three'
import type { StageCameraObject } from '../domain/sceneTypes'

interface CameraModelProps {
  object: StageCameraObject
  selected: boolean
  url: string
}

const CAMERA_MODEL_SCALE = 0.16

const CameraModel: React.FC<CameraModelProps> = ({ object, selected, url }) => {
  const gltf = useGLTF(url)
  const invalidate = useThree((state) => state.invalidate)
  const scene = useMemo(() => {
    const nextScene = (gltf.scene as Group).clone(true)
    nextScene.traverse((node) => {
      if ((node as Mesh).isMesh) {
        node.frustumCulled = false
      }
    })
    return nextScene
  }, [gltf.scene])
  const material = useMemo(() => new MeshStandardMaterial(), [])

  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    scene.traverse((node) => {
      if ((node as Mesh).isMesh) {
        const mesh = node as Mesh
        mesh.material = material
      }
    })
  }, [scene, material])

  useEffect(() => {
    material.color.set(object.color)
    material.emissive.set(object.color)
    material.emissiveIntensity = selected ? 0.35 : 0
  }, [material, object.color, selected])

  // 上面的 effect 直接改材质，不经过 R3F 属性；按需渲染下每次提交后补一帧，模型异步加载完成时也靠这一帧显示
  useEffect(() => { invalidate() })

  return (
    <group
      scale={[CAMERA_MODEL_SCALE, CAMERA_MODEL_SCALE, CAMERA_MODEL_SCALE]}
      rotation={[0, Math.PI, 0]}
    >
      <primitive object={scene} />
    </group>
  )
}

export default CameraModel
