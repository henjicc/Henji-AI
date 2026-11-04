import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { StagePrimitiveObject, StageVec3 } from '../domain/sceneTypes'
import { registerPlaybackApplier } from '../store/playbackAppliers'
import { useCameraStageStore } from '../store/cameraStageStore'
import { useStagePrimitiveResources, type StagePrimitiveSlot } from './stagePrimitiveResources'

interface BatchEntry {
  object: StagePrimitiveObject
  slot: StagePrimitiveSlot
  /** 最近一次同步时的轮次，没赶上本轮的就是被移出了 */
  generation: number
}

/**
 * 把未选中的可见基础几何体写进所在 Canvas 的合批：不挂逐物体组件，React 提交时按对象引用
 * 比对增量同步；播放期只为有轨道的物体注册应用函数，直写合批位置。
 */
const StagePrimitiveBatch: React.FC<{ objects: readonly StagePrimitiveObject[] }> = ({ objects }) => {
  const resources = useStagePrimitiveResources()
  const entriesRef = useRef(new Map<string, BatchEntry>())
  const generationRef = useRef(0)
  const tracks = useCameraStageStore((state) => state.animation.tracks)
  const trackedIds = useMemo(() => new Set(tracks.map((track) => track.objectId)), [tracks])
  const appliersRef = useRef(new Map<string, () => void>())

  useLayoutEffect(() => {
    const entries = entriesRef.current
    const generation = ++generationRef.current
    for (const object of objects) {
      let entry = entries.get(object.id)
      if (entry && entry.slot.kind !== object.kind) {
        resources.releaseSlot(entry.slot)
        entry = undefined
      }
      if (!entry) {
        entry = { object, slot: resources.acquireSlot(object.id, object.kind, object.color), generation }
        entries.set(object.id, entry)
        resources.setSlotTransform(entry.slot, object.transform)
        continue
      }
      entry.generation = generation
      if (entry.object === object) continue
      entry.object = object
      resources.setSlotTransform(entry.slot, object.transform)
      resources.setSlotColor(entry.slot, object.color)
    }
    if (entries.size === objects.length) return
    for (const [id, entry] of entries) {
      if (entry.generation === generation) continue
      resources.releaseSlot(entry.slot)
      entries.delete(id)
    }
  }, [objects, resources])

  useLayoutEffect(() => () => {
    for (const entry of entriesRef.current.values()) resources.releaseSlot(entry.slot)
    entriesRef.current.clear()
  }, [resources])

  // 播放驱动只给有轨道的物体推送采样值，没轨道的物体不必注册
  useEffect(() => {
    const registered = appliersRef.current
    const entries = entriesRef.current
    for (const [id, unregister] of registered) {
      if (trackedIds.has(id) && entries.has(id)) continue
      unregister()
      registered.delete(id)
    }
    for (const id of trackedIds) {
      if (registered.has(id) || !entries.has(id)) continue
      // 换形状会换位置，应用时再按 id 取当前位置
      const slotOf = (): StagePrimitiveSlot | undefined => entriesRef.current.get(id)?.slot
      const unregisters = [
        registerPlaybackApplier(id, 'transform.position', (value) => {
          const slot = slotOf()
          if (slot) resources.setSlotTransform(slot, { position: value as StageVec3 })
        }),
        registerPlaybackApplier(id, 'transform.rotation', (value) => {
          const slot = slotOf()
          if (slot) resources.setSlotTransform(slot, { rotation: value as StageVec3 })
        }),
        registerPlaybackApplier(id, 'transform.scale', (value) => {
          const slot = slotOf()
          if (slot) resources.setSlotTransform(slot, { scale: value as StageVec3 })
        }),
        registerPlaybackApplier(id, 'color', (value) => {
          const slot = slotOf()
          if (slot) resources.setSlotColor(slot, value as string)
        }),
      ]
      registered.set(id, () => unregisters.forEach((unregister) => unregister()))
    }
  }, [objects, resources, trackedIds])

  useEffect(() => () => {
    for (const unregister of appliersRef.current.values()) unregister()
    appliersRef.current.clear()
  }, [])

  return null
}

export default StagePrimitiveBatch
