import { useLayoutEffect, useRef, useState } from 'react'
import { activeVideoEditInstance, requireVideoEditInstance, subscribeVideoEditView, type VideoEditInstance } from '../application/videoEditService'

/** A visible composite editor owns one trial. Playback and the trial's own
 * document publication do not invalidate it; moving to another target does. */
export function useVideoEditCompositeAction(owner: VideoEditInstance, scope: string, onError: (reason: unknown) => void) {
  const mounted = useRef(true)
  const pending = useRef<AbortController>()
  const observe = useRef<() => void>()
  const identity = useRef({ owner, scope }); identity.current = { owner, scope }
  const [busy, setBusy] = useState(false)
  useLayoutEffect(() => {
    mounted.current = true; setBusy(false)
    return () => {
      mounted.current = false; pending.current?.abort(new Error('片段编辑已取消。')); pending.current = undefined
      observe.current?.(); observe.current = undefined
    }
  }, [owner, scope])
  const run = async <T,>(operation: (signal: AbortSignal) => Promise<T>, onDone?: (value: T) => void): Promise<void> => {
    if (!mounted.current || pending.current || identity.current.owner !== owner || identity.current.scope !== scope) return
    const controller = new AbortController()
    try {
      if (requireVideoEditInstance(owner.document.id) !== owner) return
      const projectId = owner.document.id; const sequenceId = owner.activeSequenceId; const selection = owner.selection
      const foreground = activeVideoEditInstance() === owner
      pending.current = controller; setBusy(true)
      observe.current = subscribeVideoEditView(() => {
        try {
          if (requireVideoEditInstance(projectId) !== owner || owner.activeSequenceId !== sequenceId || owner.selection !== selection || foreground && activeVideoEditInstance() !== owner) controller.abort(new Error('已切换片段，检查不会修改原选区。'))
        } catch (error) { controller.abort(error) }
      })
      const value = await operation(controller.signal)
      if (mounted.current && pending.current === controller && !controller.signal.aborted && requireVideoEditInstance(projectId) === owner) onDone?.(value)
    } catch (error) {
      if (mounted.current && pending.current === controller && !controller.signal.aborted) onError(error)
    } finally {
      if (pending.current === controller) {
        pending.current = undefined; observe.current?.(); observe.current = undefined
        if (mounted.current) setBusy(false)
      }
    }
  }
  return { busy, run, cancel: () => pending.current?.abort(new Error('片段编辑已取消。')) }
}
