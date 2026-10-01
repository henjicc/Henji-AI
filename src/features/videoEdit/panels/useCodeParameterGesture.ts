import { useLayoutEffect, useRef, useState } from 'react'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import type { VideoEditCodeTarget } from '../application/videoEditCodeParameters'
import { beginVideoEditGesture, finishVideoEditGesture, type VideoEditGesture } from '../application/videoEditService'

/** A mounted control owns one fixed-target edit; its draft never follows the selection. */
export function useCodeParameterGesture(target: VideoEditCodeTarget, onError: (reason: unknown) => void, time?: VideoEditSourceTime) {
  const handle = useRef<VideoEditGesture>()
  const armed = useRef(false)
  const mounted = useRef(true)
  const cancelled = useRef(false)
  const currentTime = useRef(time)
  const gestureTime = useRef<VideoEditSourceTime>()
  const errorHandler = useRef(onError)
  const [epoch, setEpoch] = useState(0)
  currentTime.current = time
  errorHandler.current = onError
  const scope = JSON.stringify([target.projectId, target.sequenceId, target.clipId, target.versionId])

  useLayoutEffect(() => {
    mounted.current = true
    cancelled.current = false
    return () => {
      mounted.current = false
      const previous = handle.current
      handle.current = undefined
      armed.current = false
      gestureTime.current = undefined
      if (previous) finishVideoEditGesture(previous, false)
    }
  }, [scope])

  const cancel = (): void => {
    const previous = handle.current
    handle.current = undefined
    armed.current = false
    gestureTime.current = undefined
    cancelled.current = true
    if (previous) finishVideoEditGesture(previous, false)
    if (mounted.current) setEpoch(value => value + 1)
  }
  const begin = (): void => {
    if (!mounted.current || armed.current) return
    cancelled.current = false
    armed.current = true
    gestureTime.current = currentTime.current && structuredClone(currentTime.current)
  }
  const finish = (): void => {
    const previous = handle.current
    handle.current = undefined
    armed.current = false
    gestureTime.current = undefined
    if (!previous) return
    try { finishVideoEditGesture(previous) } catch (error) {
      finishVideoEditGesture(previous, false)
      errorHandler.current(error)
    }
  }
  const write = (operation: (gesture: VideoEditGesture | undefined, at: VideoEditSourceTime | undefined) => void): void => {
    if (!mounted.current || cancelled.current) return
    try {
      // Focus/pointer-down only capture the target time. Untouched controls must not gate autosave.
      if (!armed.current) begin()
      if (!handle.current) handle.current = beginVideoEditGesture(target.projectId)
      operation(handle.current, gestureTime.current)
    } catch (error) {
      cancel()
      errorHandler.current(error)
    }
  }
  const atomic = (operation: Parameters<typeof write>[0]): void => { begin(); write(operation); finish() }
  return { begin, finish, cancel, write, atomic, epoch, active: () => armed.current }
}
