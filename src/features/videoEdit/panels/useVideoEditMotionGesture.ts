import { useEffect, useRef, type PointerEvent } from 'react'
import { translateAffine } from '@/core/imaging/transforms'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { videoEditClipAnimatedValueSchemas } from '@/core/videoEdit/keyframes'
import type { Pose } from '@/core/creativeIntent/contracts'
import { listVideoEditInstances, type VideoEditInstance } from '../application/videoEditService'
import { demonstrateVideoMotion, pauseVideoMotion, setVideoMotionPointer, videoMotionState, type MotionCaptureProperty } from '../application/videoEditMotionDraft'

interface Pointer { id: number; x: number; y: number; width: number; height: number; pose: Pose; property: MotionCaptureProperty; sequence: string; clip: string | null; window: Window; moved: boolean; release: () => void }
export function useVideoEditMotionGesture(owner: VideoEditInstance, onError: (error: unknown) => void): { down: (event: PointerEvent<HTMLDivElement>) => void; move: (event: PointerEvent<HTMLDivElement>) => void; up: (event: PointerEvent<HTMLDivElement>) => void; cancel: () => void } {
  const pointer = useRef<Pointer>()
  const isOpen = (): boolean => listVideoEditInstances().includes(owner)
  const cancel = (): void => { pointer.current?.release(); pointer.current = undefined; if (isOpen()) setVideoMotionPointer(owner.document.id, false) }
  const pause = (): void => { if (isOpen()) pauseVideoMotion(owner.document.id) }
  useEffect(() => () => cancel(), [owner]) // eslint-disable-line react-hooks/exhaustive-deps
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const p = pointer.current; const state = videoMotionState(owner)
    if (!p || p.id !== event.pointerId || !state || state.status !== 'recording') return
    if (owner.activeSequenceId !== p.sequence || owner.selection !== p.clip) { cancel(); return }
    if (p.property !== state.property) { p.pose = structuredClone(state.pose); p.property = state.property; p.x = event.clientX; p.y = event.clientY }
    const pose = structuredClone(p.pose); const dx = (event.clientX - p.x) / p.width; const dy = (event.clientY - p.y) / p.height
    if (p.property === 'position') { const mapped = translateAffine([1, 0, 0, 1, p.pose.position[0], p.pose.position[1]], [dx, dy]); pose.position = [mapped[4], mapped[5]] }
    else if (p.property === 'rotationTurns') pose.rotationTurns += dx
    else { const scale = pose.scaleXY[0] * Math.exp(dx * 2); pose.scaleXY = [scale, scale] }
    if (JSON.stringify(pose[p.property]) === JSON.stringify(state.pose[p.property])) return
    try {
      if (!videoEditClipAnimatedValueSchemas.x.safeParse(pose.position[0] - .5).success || !videoEditClipAnimatedValueSchemas.y.safeParse(pose.position[1] - .5).success || !videoEditClipAnimatedValueSchemas.rotation.safeParse(pose.rotationTurns * 360).success || !videoEditClipAnimatedValueSchemas.scale.safeParse(pose.scaleXY[0]).success) throw new Error('这个姿态超出了片段的可编辑范围，请缩小移动、旋转或缩放幅度后继续。')
      p.moved = true; demonstrateVideoMotion(owner.document.id, pose, 'sample', p.window.performance.timeOrigin + event.timeStamp - performance.timeOrigin)
    } catch (error) { cancel(); pause(); onError(error) }
    event.preventDefault(); event.stopPropagation()
  }
  const down = (event: PointerEvent<HTMLDivElement>): void => {
    const state = videoMotionState(owner); if (!state || state.status !== 'recording' || event.button !== 0) return
    // 沿现有增量手势计算；无需预选属性，修饰键直接表达旋转或缩放。
    if (state.automatic) state.property = event.shiftKey ? 'rotationTurns' : event.ctrlKey || event.metaKey ? 'scaleXY' : 'position'
    const rect = event.currentTarget.getBoundingClientRect(); if (!rect.width || !rect.height) return
    cancel(); const target = ownerWindowOf(event.currentTarget)
    const blur = (): void => { cancel(); pause() }
    const escape = (key: KeyboardEvent): void => { if (key.key === 'Escape') { cancel(); pause() } }
    target.addEventListener('blur', blur); target.addEventListener('keydown', escape)
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, pose: structuredClone(state.pose), property: state.property, sequence: owner.activeSequenceId, clip: owner.selection, window: target, moved: false, release: () => { target.removeEventListener('blur', blur); target.removeEventListener('keydown', escape) } }
    setVideoMotionPointer(owner.document.id, true)
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation()
  }
  const up = (event: PointerEvent<HTMLDivElement>): void => {
    if (!pointer.current || pointer.current.id !== event.pointerId) return
    const pointerState = pointer.current
    move(event); const state = videoMotionState(owner)
    if (state?.status === 'recording' && pointerState.moved) demonstrateVideoMotion(owner.document.id, state.pose, 'up', pointerState.window.performance.timeOrigin + event.timeStamp - performance.timeOrigin)
    cancel()
  }
  return { down, move, up, cancel }
}
