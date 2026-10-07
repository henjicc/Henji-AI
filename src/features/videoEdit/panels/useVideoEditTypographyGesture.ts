import { useEffect, useRef } from 'react'
import { beginVideoEditGesture, finishVideoEditGesture, type VideoEditGesture } from '../application/videoEditService'

/** Typography scrubs share the project's existing gesture, including cancellation and one undo. */
export function useVideoEditTypographyGesture(projectId: string, identity: string, onError: (error: unknown) => void) {
  const handle = useRef<VideoEditGesture>()
  useEffect(() => () => { const previous = handle.current; handle.current = undefined; if (previous) finishVideoEditGesture(previous, false) }, [projectId, identity])
  return {
    handle,
    begin: (): void => { try { handle.current ??= beginVideoEditGesture(projectId) } catch (error) { onError(error) } },
    end: (commit: boolean): void => { const previous = handle.current; handle.current = undefined; if (previous) { try { finishVideoEditGesture(previous, commit) } catch (error) { finishVideoEditGesture(previous, false); onError(error) } } },
  }
}
