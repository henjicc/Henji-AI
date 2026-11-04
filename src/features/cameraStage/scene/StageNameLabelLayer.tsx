import React, { createRef, memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Vector3, type Group, type Object3D } from 'three'
import type { StageNameLabelSettings, StageObject } from '../domain/sceneTypes'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { useStagePrimitiveResources } from './stagePrimitiveResources'

/**
 * 名称标签层：一个 Canvas 只挂一层。合批物体没有自己的节点，标签按对象 id 取世界包围盒
 * （合批物体按合批位置的矩阵算），锚点放在世界空间里，逐帧摆到对象正上方。
 */

interface StageNameLabelLayerProps {
  /** 要画标签的对象（已排除隐藏、无名与摄像机视角下正在取景的那台） */
  objects: readonly StageObject[]
  settings: StageNameLabelSettings
  /** 自己挂了组件的对象（选中的、角色、摄像机）的根节点；其余对象在合批里 */
  nodes: React.RefObject<ReadonlyMap<string, Object3D>>
}

function getLabelPadding(object: StageObject, boundsHeight: number): number {
  if (object.type === 'character') {
    return Math.max(0.28, boundsHeight * 0.16)
  }

  if (object.type === 'camera') {
    return Math.max(0.16, boundsHeight * 0.14)
  }

  return Math.max(0.18, boundsHeight * 0.14)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function toRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace('#', '')
  const safeAlpha = clamp01(alpha)

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    const r = Number.parseInt(normalized[0] + normalized[0], 16)
    const g = Number.parseInt(normalized[1] + normalized[1], 16)
    const b = Number.parseInt(normalized[2] + normalized[2], 16)
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
  }

  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    const r = Number.parseInt(normalized.slice(0, 2), 16)
    const g = Number.parseInt(normalized.slice(2, 4), 16)
    const b = Number.parseInt(normalized.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
  }

  return hex
}

const StageNameLabel = memo<{
  name: string
  color: string
  settings: StageNameLabelSettings
  anchorRef: React.RefObject<Group>
  initialPosition: Vector3
}>(({ name, color, settings, anchorRef, initialPosition }) => {
  const effectiveBackgroundColor = settings.followObjectColor ? color : settings.backgroundColor
  const backgroundColor = toRgba(effectiveBackgroundColor, settings.backgroundOpacity)
  const shadowColor = toRgba(settings.shadowColor, settings.shadowOpacity)
  const shadowRadians = settings.shadowAngle * (Math.PI / 180)
  const shadowOffsetX = Math.cos(shadowRadians) * settings.shadowDistance
  const shadowOffsetY = Math.sin(shadowRadians) * settings.shadowDistance
  const textShadow = `${shadowOffsetX.toFixed(2)}px ${shadowOffsetY.toFixed(2)}px ${settings.shadowBlur.toFixed(2)}px ${shadowColor}`

  return (
    // 锚点在世界空间，由标签层逐帧摆到对象正上方；挂载时就放在挑选那一帧算好的位置
    <group ref={anchorRef} position={initialPosition}>
      <Html
        center
        transform
        sprite
        distanceFactor={8}
        occlude={false}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          className="rounded-md border border-line px-2 py-1 text-xs font-medium shadow-panel"
          style={{
            color: settings.textColor,
            backgroundColor,
            textShadow,
            transform: `scale(${settings.scale})`,
            transformOrigin: 'center center',
          }}
        >
          {name}
        </div>
      </Html>
    </group>
  )
})
StageNameLabel.displayName = 'StageNameLabel'

interface ShownLabel {
  object: StageObject
  anchor: React.RefObject<Group>
  position: Vector3
}

function sameLabels(a: readonly ShownLabel[], b: readonly ShownLabel[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i].object !== b[i].object) return false
  return true
}

const StageNameLabelLayer: React.FC<StageNameLabelLayerProps> = ({ objects, settings, nodes }) => {
  const resources = useStagePrimitiveResources()
  const invalidate = useThree((state) => state.invalidate)
  const canvas = useThree((state) => state.gl.domElement)
  const [shown, setShown] = useState<readonly ShownLabel[]>([])
  // 新挂上的 Html 要等它自己的 React 根提交出内层节点后，下一次出帧才摆到位，之前贴在画布左上角；
  // 那次提交不经过本画布，按需渲染下要再续两帧
  useLayoutEffect(() => {
    invalidate()
    // 画布可能在浮窗里，按它所在窗口排帧
    const view = ownerWindowOf(canvas)
    let frame = view.requestAnimationFrame(() => {
      invalidate()
      frame = view.requestAnimationFrame(() => invalidate())
    })
    return () => view.cancelAnimationFrame(frame)
  }, [canvas, invalidate, shown])
  const labelsRef = useRef(new Map<string, ShownLabel>())
  const scratch = useMemo(() => ({ bounds: new Box3(), center: new Vector3() }), [])

  const objectPosition = (id: string, target: Vector3): boolean => {
    const slot = resources.slot(id)
    if (slot) {
      target.copy(slot.position)
      return true
    }
    const node = nodes.current?.get(id)
    if (!node) return false
    node.updateWorldMatrix(true, false)
    node.getWorldPosition(target)
    return true
  }
  // 与对整个对象做 Box3.setFromObject 一致；合批物体按合批位置的矩阵算
  const objectBounds = (id: string, target: Box3): boolean => {
    const slot = resources.slot(id)
    if (slot) {
      resources.slotBounds(slot, target)
      return true
    }
    const node = nodes.current?.get(id)
    if (!node) return false
    target.setFromObject(node)
    return true
  }

  // 优先级 -1：排在播放驱动（-2）写完本帧变换之后、Html 逐帧算 CSS 变换（0）之前，标签当帧跟上
  useFrame(() => {
    const { bounds, center } = scratch
    const labels = labelsRef.current
    const next: ShownLabel[] = []
    for (const object of objects) {
      const hasBounds = objectBounds(object.id, bounds) && !bounds.isEmpty()
      // 没有可见几何的对象（摄像机视角下其他摄像机的辅助模型不画）标签落在对象原点
      if (!hasBounds && !objectPosition(object.id, center)) continue
      let label = labels.get(object.id)
      if (!label) {
        label = { object, anchor: createRef<Group>(), position: new Vector3() }
        labels.set(object.id, label)
      } else if (label.object !== object) {
        label = { ...label, object }
        labels.set(object.id, label)
      }
      if (hasBounds) {
        const padding = getLabelPadding(object, Math.max(0.01, bounds.max.y - bounds.min.y))
        bounds.getCenter(center)
        label.position.set(
          center.x + settings.offset.x,
          bounds.max.y + padding + settings.offset.y,
          center.z + settings.offset.z,
        )
      } else {
        label.position.copy(center)
      }
      label.anchor.current?.position.copy(label.position)
      next.push(label)
    }
    if (sameLabels(next, shown)) return
    if (next.length < labels.size) {
      const keep = new Set(next.map((label) => label.object.id))
      for (const id of labels.keys()) if (!keep.has(id)) labels.delete(id)
    }
    setShown(next)
  }, -1)

  return (
    <>
      {shown.map(({ object, anchor, position }) => {
        const name = object.name.trim()
        return name ? (
          <StageNameLabel
            key={object.id}
            name={name}
            color={object.color}
            settings={settings}
            anchorRef={anchor}
            initialPosition={position}
          />
        ) : null
      })}
    </>
  )
}

export default StageNameLabelLayer
