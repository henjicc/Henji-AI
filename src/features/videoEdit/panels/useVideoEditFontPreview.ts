import { useEffect, useRef } from 'react'
import { beginVideoEditGesture, finishVideoEditGesture, requireVideoEditInstance, type VideoEditGesture } from '../application/videoEditService'
/** Preview owns a fixed project identity and always rolls back before a normal selection commit. */
export function useVideoEditFontPreview(projectId: string, scope: string, onError: (error: unknown) => void, write: (name: string, gesture: VideoEditGesture) => void): (name: string | null) => void {
  const owner = requireVideoEditInstance(projectId)
  const active = useRef<VideoEditGesture>()
  const callback = useRef(write); callback.current = write
  const errors = useRef(onError); errors.current = onError
  useEffect(() => () => { const previous = active.current; active.current = undefined; if (previous) finishVideoEditGesture(previous, false) }, [projectId, scope, owner])
  return name => {
    const previous = active.current; active.current = undefined
    if (previous) finishVideoEditGesture(previous, false)
    if (!name) return
    try {
      if (requireVideoEditInstance(projectId) !== owner) return
      const gesture = beginVideoEditGesture(projectId); active.current = gesture
      callback.current(name, gesture)
    } catch (error) { const gesture = active.current; active.current = undefined; if (gesture) finishVideoEditGesture(gesture, false); errors.current(error) }
  }
}
