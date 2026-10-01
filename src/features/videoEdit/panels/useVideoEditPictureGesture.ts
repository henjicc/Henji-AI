import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, setVideoEditView, subscribeVideoEditView, updateVideoEditPicturePosition, videoEditProgramCommandIdentity, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'

interface PicturePointer { pointerId: number; x: number; y: number; width: number; height: number; offsetX: number; offsetY: number; sequenceId: string; clipId: string; frame: number; command: object; selectedClipIds: string[]; gesture: VideoEditGesture }
export function useVideoEditPictureGesture(instance: VideoEditInstance, enabled: boolean, onError: (error: unknown) => void): { down: (event: ReactPointerEvent<HTMLDivElement>) => void; move: (event: ReactPointerEvent<HTMLDivElement>) => void; up: (event: ReactPointerEvent<HTMLDivElement>) => void; cancel: () => void } {
  const pointer = useRef<PicturePointer>()
  /** 失焦与 Escape 只在手势期间监听画面实际所在的窗口（可能是系统浮窗），结束即移除。 */
  const follow = useRef<(target: Window) => () => void>()
  const unfollow = useRef<() => void>()
  const release = (): void => { unfollow.current?.(); unfollow.current = undefined }
  const cancel = (): void => { release(); const value = pointer.current; pointer.current = undefined; if (value) finishVideoEditGesture(value.gesture, false) }
  const valid = (value: PicturePointer): boolean => instance.activeSequenceId === value.sequenceId && instance.selection === value.clipId && instance.selectedClipIds.length === value.selectedClipIds.length && instance.selectedClipIds.every((id, index) => id === value.selectedClipIds[index]) && instance.frame === value.frame && videoEditProgramCommandIdentity(instance.document.id) === value.command
  useEffect(() => {
    if (!enabled) cancel()
    const blur = (): void => cancel()
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && pointer.current) { event.preventDefault(); cancel() } }
    const unsubscribe = subscribeVideoEditView(() => { const value = pointer.current; if (value && !valid(value)) cancel() })
    const listen = (target: Window): (() => void) => {
      target.addEventListener('blur', blur); target.addEventListener('keydown', escape)
      return () => { target.removeEventListener('blur', blur); target.removeEventListener('keydown', escape) }
    }
    follow.current = listen
    return () => { follow.current = undefined; unsubscribe(); cancel() }
    // The callbacks read the stable owner and pointer; view changes are subscribed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, enabled])
  const down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!enabled || event.button !== 0 || !instance.selection) return
    const sequence = getActiveVideoEditSequence(instance); const clip = sequence.clips.find(clip => clip.id === instance.selection)
    if (!clip || clip.kind === 'audio' || instance.frame < clip.start || instance.frame >= clip.start + clip.duration) return
    try {
      cancel(); setVideoEditView(instance.document.id, { playing: false })
      const rect = event.currentTarget.getBoundingClientRect(); if (!rect.width || !rect.height) return
      const gesture = beginVideoEditGesture(instance.document.id)
      pointer.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, offsetX: clip.x, offsetY: clip.y, sequenceId: sequence.id, clipId: clip.id, frame: instance.frame, command: videoEditProgramCommandIdentity(instance.document.id), selectedClipIds: [...instance.selectedClipIds], gesture }
      unfollow.current = follow.current?.(ownerWindowOf(event.currentTarget))
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault()
    } catch (error) { cancel(); onError(error) }
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const value = pointer.current; if (!value || event.pointerId !== value.pointerId) return
    if (!valid(value)) { cancel(); return }
    try { updateVideoEditPicturePosition(value.gesture, value.sequenceId, value.clipId, { x: Math.max(-2, Math.min(2, value.offsetX + (event.clientX - value.x) / value.width)), y: Math.max(-2, Math.min(2, value.offsetY + (event.clientY - value.y) / value.height)) }) } catch (error) { cancel(); onError(error) }
  }
  const up = (event: ReactPointerEvent<HTMLDivElement>): void => { const value = pointer.current; if (!value || event.pointerId !== value.pointerId) return; if (!valid(value)) { cancel(); return } move(event); if (pointer.current) { release(); pointer.current = undefined; finishVideoEditGesture(value.gesture) } }
  return { down, move, up, cancel }
}
