import React, { createRef, memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Matrix4, Vector3, type Group, type Object3D } from 'three'
import type { StageNameLabelSettings, StageObject } from '../domain/sceneTypes'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { useStagePrimitiveResources } from './stagePrimitiveResources'

/**
 * 名称标签层：一个 Canvas 只挂一层，只给视口内离相机最近的若干个对象画标签。
 *
 * 标签是 drei Html 的 CSS 三维变换节点，每个都是一块和画布等大的合成层，逐帧改变换；上万个物体
 * 全开时浏览器直接卡死，而且那么多标签叠在一起也读不出来。所以逐帧按对象位置挑出视口内最近的
 * 一批，只为它们挂 DOM，外观仍是原来的 Html 标签。
 */

/** 每个窗格同时显示的标签上限：再多就互相叠住读不出字，而且每个标签每帧都要改一次 CSS 变换。 */
const STAGE_NAME_LABEL_LIMIT = 120

/** 投影后超出画面这么多（NDC）仍算视口内：对象中心刚出画时，标签往往还在画面里。 */
const VIEW_MARGIN = 1.15

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
  const scratch = useMemo(() => ({
    position: new Vector3(),
    projected: new Vector3(),
    viewProjection: new Matrix4(),
    bounds: new Box3(),
    center: new Vector3(),
    cameraPosition: new Vector3(),
    // 候选只存对象下标、距离按下标存：上万个对象逐帧挑选不产生临时对象
    candidates: [] as number[],
    distances: new Float64Array(0),
  }), [])

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
  useFrame(({ camera }) => {
    const { position, projected, viewProjection, bounds, center, cameraPosition, candidates } = scratch
    if (scratch.distances.length < objects.length) scratch.distances = new Float64Array(objects.length)
    const { distances } = scratch
    camera.updateMatrixWorld()
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    camera.getWorldPosition(cameraPosition)
    candidates.length = 0
    for (let order = 0; order < objects.length; order += 1) {
      const object = objects[order]
      if (!objectPosition(object.id, position)) continue
      projected.copy(position).applyMatrix4(viewProjection)
      if (projected.z < -1 || projected.z > 1) continue
      if (Math.abs(projected.x) > VIEW_MARGIN || Math.abs(projected.y) > VIEW_MARGIN) continue
      distances[order] = position.distanceToSquared(cameraPosition)
      candidates.push(order)
    }
    if (candidates.length > STAGE_NAME_LABEL_LIMIT) {
      candidates.sort((a, b) => distances[a] - distances[b])
      candidates.length = STAGE_NAME_LABEL_LIMIT
      // 按对象顺序排列：只是远近次序变化时标签集合不变，不触发重渲染
      candidates.sort((a, b) => a - b)
    }

    const labels = labelsRef.current
    const next: ShownLabel[] = []
    for (const order of candidates) {
      const object = objects[order]
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
    candidates.length = 0
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
