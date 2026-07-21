import React, { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
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
