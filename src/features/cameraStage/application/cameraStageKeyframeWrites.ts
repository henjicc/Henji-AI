import type { StageObject, StageObjectPatch } from '../domain/sceneTypes'
import type { StageStateKeyframeTransitionObjectDetail } from '../domain/stateKeyframeTypes'
import { quantizeToFrame } from '../stateKeyframes/timeline/stateKeyframeClipGeometry'
import { cameraStageProjectStore } from './cameraStageProjectRuntime'

/**
 * 算法能力往时间轴上写状态的共用步骤，全部经过正式 store 动作（与界面拖动、定机位同一条路），
 * 每一步都重编译，后一步看到的就是前一步写完的画面。
 */

type Store = ReturnType<typeof cameraStageProjectStore>

export function stateKeyframeTimeAt(store: Store, time: number): number {
  return quantizeToFrame(time, store.getState().animation.fps)
}

/** time 那一刻的状态关键帧：已有就用（按帧对齐），没有就新建（其余对象记下那一刻的播放画面）。 */
export function ensureStateKeyframeAt(store: Store, time: number): { id: string; created: boolean } {
  const quantized = stateKeyframeTimeAt(store, time)
  const fps = store.getState().animation.fps
  const before = store.getState().stateKeyframes
  const existing = before.find((item) => Math.abs(item.time - quantized) <= 1 / (2 * Math.max(1, fps)))
  if (existing) return { id: existing.id, created: false }
  store.getState().seek(quantized)
  store.getState().addStateKeyframe()
  const id = store.getState().selectedStateKeyframeId
  if (!id) throw new Error('CAPABILITY_REJECTED')
  return { id, created: true }
}

/** 只把这个对象的这些字段记进这一张状态关键帧。 */
export function writeObjectAtStateKeyframe(store: Store, stateKeyframeId: string, objectId: string, patch: StageObjectPatch): void {
  store.getState().selectStateKeyframe(stateKeyframeId)
  store.getState().updateObject(objectId, patch)
}

/** 合并这一张状态关键帧到下一张之间、这个对象的过渡细节（只改给出的字段）。 */
export function mergeTransitionDetail(store: Store, stateKeyframeId: string, objectId: string, patch: StageStateKeyframeTransitionObjectDetail, remove: Array<keyof StageStateKeyframeTransitionObjectDetail> = []): void {
  const stateKeyframe = store.getState().stateKeyframes.find((item) => item.id === stateKeyframeId)
  if (!stateKeyframe) throw new Error('CAPABILITY_REJECTED')
  const existing = stateKeyframe.transition.perObject[objectId] ?? {}
  if (Object.keys(patch).length === 0 && !remove.some((key) => key in existing)) return
  const detail = { ...existing, ...patch }
  for (const key of remove) delete detail[key]
  store.getState().updateStateKeyframeTransition(stateKeyframeId, { perObject: { [objectId]: detail } })
}

/** 插入的状态关键帧把哪些别的对象的运动分成了两段（它们原来在这一刻前后位置不同）。 */
export function splitMovers(objects: readonly StageObject[], before: { stateKeyframes: Array<{ time: number; objectStates: Record<string, { transform: { position: { x: number; y: number; z: number } } }> }> }, times: readonly number[], except: ReadonlySet<string>): string[] {
  const names = new Set<string>()
  for (const time of times) {
    const after = before.stateKeyframes.findIndex((item) => item.time > time + 1e-6)
    if (after <= 0) continue
    const previous = before.stateKeyframes[after - 1]
    const next = before.stateKeyframes[after]
    if (Math.abs(previous.time - time) < 1e-6) continue
    for (const object of objects) {
      if (except.has(object.id) || object.setId) continue
      const a = previous.objectStates[object.id]?.transform.position
      const b = next.objectStates[object.id]?.transform.position
      if (a && b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-3) names.add(object.name)
    }
  }
  return [...names]
}
