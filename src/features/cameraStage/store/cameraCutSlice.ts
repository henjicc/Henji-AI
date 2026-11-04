import type { StoreApi } from 'zustand'

import type { StageCoverage } from '../domain/coverage'
import { createCameraCut, type StageCameraCut } from '../domain/renderCameraSchedule'
import { quantizeToFrame } from '../stateKeyframes/timeline/stateKeyframeClipGeometry'
import type { CameraStageState } from './cameraStageStore'

/*
 * 机位轨：切换点只决定哪台摄像机在拍，不碰状态关键帧，所以切机位、挪切点都不会改变场景里的运动。
 * 人和助手逐个增删改的切点原样保留（只按时间排序），不顺带删掉别的切点；“切到正在拍的同一台”只是多余，
 * 播放与检查都把它当成同一镜。整段重剪（replaceCameraCuts）只在重剪区间内并掉多余切点，由剪辑能力按前后差异上报。
 */

export interface CameraCutSliceActions {
  /** 在 time（按帧对齐）切到 cameraId；那一帧已有切点就改它的机位。 */
  setCameraCutAt: (time: number, cameraId: string | null) => void
  moveCameraCut: (id: string, time: number) => void
  updateCameraCutCamera: (id: string, cameraId: string | null) => void
  removeCameraCut: (id: string) => void
  /**
   * 用一组切点换掉 [start, end) 内原有的切点；end 之后按原来在拍的机位接回去。一次写入一条撤销记录。
   */
  replaceCameraCuts: (start: number, end: number, cuts: ReadonlyArray<{ time: number; cameraId: string | null }>) => void
  /** 新增或按 id 替换一组覆盖。 */
  setCoverage: (coverage: StageCoverage) => void
}

type Set = StoreApi<CameraStageState>['setState']

/** time 那一刻在拍的机位；第一个切点之前是活动摄像机（null）。 */
export function cameraLiveAt(cuts: readonly StageCameraCut[], time: number): string | null {
  let live: string | null = null
  for (const cut of cuts) {
    if (cut.time > time + 1e-9) break
    live = cut.cameraId
  }
  return live
}

/** 排序，并去掉 [from, to] 内与前一段同机位的切点（第一个切点切到活动摄像机 null 也算多余）；区间外的原样保留。 */
function tidyCameraCuts(cuts: readonly StageCameraCut[], from: number, to: number): StageCameraCut[] {
  const sorted = [...cuts].sort((left, right) => left.time - right.time)
  const result: StageCameraCut[] = []
  for (const cut of sorted) {
    const previous = result[result.length - 1]
    const inside = cut.time >= from - 1e-9 && cut.time <= to + 1e-9
    if (previous && Math.abs(previous.time - cut.time) < 1e-9) { result[result.length - 1] = cut; continue }
    const live = previous ? previous.cameraId : null
    if (inside && cut.cameraId === live) continue
    result.push(cut)
  }
  return result
}

const sortCuts = (cuts: readonly StageCameraCut[]): StageCameraCut[] => [...cuts].sort((left, right) => left.time - right.time)

export function createCameraCutSlice(set: Set): CameraCutSliceActions {
  const frameOf = (state: CameraStageState): number => 1 / Math.max(1, state.animation.fps)
  return {
    setCameraCutAt: (time, cameraId) => set((state) => {
      const quantized = quantizeToFrame(Math.max(0, time), state.animation.fps)
      const half = frameOf(state) / 2
      const existing = state.cameraCuts.find((cut) => Math.abs(cut.time - quantized) <= half)
      const cuts = existing
        ? state.cameraCuts.map((cut) => cut.id === existing.id ? { ...cut, cameraId } : cut)
        : [...state.cameraCuts, createCameraCut(quantized, cameraId)]
      return { cameraCuts: sortCuts(cuts) }
    }),
    moveCameraCut: (id, time) => set((state) => {
      const index = state.cameraCuts.findIndex((cut) => cut.id === id)
      if (index < 0) return {}
      const frame = frameOf(state)
      const minimum = index === 0 ? 0 : state.cameraCuts[index - 1].time + frame
      const maximum = index === state.cameraCuts.length - 1 ? Infinity : state.cameraCuts[index + 1].time - frame
      const next = Math.min(maximum, Math.max(minimum, quantizeToFrame(time, state.animation.fps)))
      return { cameraCuts: sortCuts(state.cameraCuts.map((cut) => cut.id === id ? { ...cut, time: next } : cut)) }
    }),
    updateCameraCutCamera: (id, cameraId) => set((state) => ({
      cameraCuts: state.cameraCuts.map((cut) => cut.id === id ? { ...cut, cameraId } : cut),
    })),
    removeCameraCut: (id) => set((state) => ({ cameraCuts: state.cameraCuts.filter((cut) => cut.id !== id) })),
    replaceCameraCuts: (start, end, cuts) => set((state) => {
      const fps = state.animation.fps
      const from = quantizeToFrame(start, fps)
      const to = quantizeToFrame(end, fps)
      const resumeCamera = cameraLiveAt(state.cameraCuts, to)
      const kept = state.cameraCuts.filter((cut) => cut.time < from - 1e-9 || cut.time >= to - 1e-9)
      const added = cuts.map((cut) => createCameraCut(quantizeToFrame(cut.time, fps), cut.cameraId))
        .filter((cut) => cut.time >= from - 1e-9 && cut.time < to - 1e-9)
      const resumes = !kept.some((cut) => Math.abs(cut.time - to) < 1e-9)
        ? [createCameraCut(to, resumeCamera)]
        : []
      return { cameraCuts: tidyCameraCuts([...kept, ...added, ...resumes], from, to) }
    }),
    setCoverage: (coverage) => set((state) => ({
      coverages: state.coverages.some((item) => item.id === coverage.id)
        ? state.coverages.map((item) => item.id === coverage.id ? coverage : item)
        : [...state.coverages, coverage],
    })),
  }
}
