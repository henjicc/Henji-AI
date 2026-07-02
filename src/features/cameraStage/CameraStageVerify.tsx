import React, { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Group, Object3D } from 'three'
import { UiOptionButton } from '@/components/ui'
import { CAMERA_STAGE_COLOR_HEX } from '@/core/theme/colorTokens'

/**
 * 运镜控制 1.1/1.2 技术验证组件（临时代码）
 *
 * 只用于验证 three.js + @react-three/fiber + @react-three/drei 在
 * Electron sandbox 环境下的渲染与交互可行性，以及 Quaternius 免费资源
 * 骨骼/动画加载可行性；验证通过后按 2.1/2.2 的正式数据模型重写，
 * 不保留本文件结构。
 *
 * 验证用模型临时放在 public/camera-stage-verify/（仅验证期占位），
 * 正式资源落地路径由 1.2 执行记录和后续任务另行确定。
 */

type GizmoMode = 'translate' | 'rotate' | 'scale'

const GIZMO_MODES: Array<{ id: GizmoMode; label: string }> = [
  { id: 'translate', label: '移动' },
  { id: 'rotate', label: '旋转' },
  { id: 'scale', label: '缩放' },
]

// 打包态用 file:// 协议加载页面，绝对路径 `/xxx` 会解析到磁盘根目录而非应用目录，
// 必须用相对路径；正式资源加载方式（2.x/3.x）应改走 henji-media:// 协议而非 public/ 静态资源。
const VERIFY_MODEL_URL = './camera-stage-verify/UAL1_Standard.glb'
const VERIFY_PROP_URL = './camera-stage-verify/Bench.glb'

/** CC0 道具模型加载验证（1.2 步骤 5）：确认静态 GLB 道具可正常加载显示。 */
const PropVerify: React.FC = () => {
  const { scene } = useGLTF(VERIFY_PROP_URL)

  useEffect(() => {
    let meshCount = 0
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshCount += 1
    })
    // eslint-disable-next-line no-console
    console.log(`[运镜控制验证] 道具 Bench.glb 加载成功，网格数量：${meshCount}`)
  }, [scene])

  return <primitive object={scene} position={[3, 0, -1]} />
}

useGLTF.preload(VERIFY_PROP_URL)

/**
 * Quaternius Universal Animation Library 加载验证（1.2 步骤 3-4）：
 * 用 SkeletonHelper 确认骨骼层级、用 AnimationMixer 播放一个动作片段。
 */
const QuaterniusCharacterVerify: React.FC = () => {
  const groupRef = useRef<Group>(null)
  const { scene, animations } = useGLTF(VERIFY_MODEL_URL)
  const { actions, names } = useAnimations(animations, groupRef)

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`[运镜控制验证] Quaternius 动画片段数量：${names.length}，前 5 个：${names.slice(0, 5).join('、')}`)

    const skeletonHelper = new THREE.SkeletonHelper(scene)
    scene.add(skeletonHelper)

    const firstClipName = names[0]
    if (firstClipName) {
      actions[firstClipName]?.reset().play()
    }
  }, [scene, names, actions])

  return <primitive ref={groupRef} object={scene} position={[0, 0, -1.8]} scale={1.2} />
}

useGLTF.preload(VERIFY_MODEL_URL)

const CameraStageVerify: React.FC = () => {
  const [selected, setSelected] = useState<Object3D | null>(null)
  const [mode, setMode] = useState<GizmoMode>('translate')

  const handleSelect = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()
    setSelected(event.eventObject)
  }

  return (
    <div className="relative flex-1 h-full bg-app">
      <Canvas
        camera={{ position: [4, 3, 6], fov: 50 }}
        style={{ background: CAMERA_STAGE_COLOR_HEX.stageBg }}
        onPointerMissed={() => setSelected(null)}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 4]} intensity={1.2} />
        <Grid
          infiniteGrid
          cellSize={0.5}
          sectionSize={2.5}
          cellColor={CAMERA_STAGE_COLOR_HEX.gridCell}
          sectionColor={CAMERA_STAGE_COLOR_HEX.gridSection}
          fadeDistance={30}
        />
        <mesh name="验证立方体" position={[-1.2, 0.5, 0]} onClick={handleSelect}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={CAMERA_STAGE_COLOR_HEX.objectWarm} />
        </mesh>
        <mesh name="验证球体" position={[1.2, 0.75, 0]} onClick={handleSelect}>
          <sphereGeometry args={[0.75, 32, 32]} />
          <meshStandardMaterial color={CAMERA_STAGE_COLOR_HEX.objectCool} />
        </mesh>
        {selected && <TransformControls object={selected} mode={mode} />}
        <Suspense fallback={null}>
          <QuaterniusCharacterVerify />
          <PropVerify />
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <div className="flex gap-2">
          {GIZMO_MODES.map((item) => (
            <UiOptionButton
              key={item.id}
              active={mode === item.id}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </UiOptionButton>
          ))}
        </div>
        <div className="text-xs text-text-muted">
          {selected
            ? `已选中：${selected.name}（拖拽 gizmo 变换，点空白处取消选中）`
            : '左键点击物体选中，左键拖拽环绕，滚轮缩放，右键拖拽平移'}
        </div>
      </div>
    </div>
  )
}

export default CameraStageVerify
