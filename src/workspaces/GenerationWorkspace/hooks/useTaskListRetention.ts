import { createContext, useEffect, useMemo, useState } from 'react'
import type { AudioPlaybackState } from '@/components/AudioPlayer'

type RetentionReason = 'focus' | 'pointer' | 'context' | 'audio' | 'collect'

function createRetention(notify: (reasons: ReadonlyMap<string, Set<RetentionReason>>) => void) {
  const reasons = new Map<string, Set<RetentionReason>>()
  const audio = new Map<string, { src: string; state: AudioPlaybackState }>()
  return {
    setActive(id: string, reason: RetentionReason, active: boolean) {
      const current = reasons.get(id) ?? new Set<RetentionReason>()
      if (current.has(reason) === active) return
      if (active) current.add(reason)
      else current.delete(reason)
      if (current.size) reasons.set(id, current)
      else reasons.delete(id)
      notify(reasons)
    },
    clearReason(reason: RetentionReason) {
      let changed = false
      for (const [id, current] of reasons) {
        if (current.delete(reason)) changed = true
        if (!current.size) reasons.delete(id)
      }
      if (changed) notify(reasons)
    },
    rememberAudio(id: string, element: HTMLAudioElement) {
      audio.set(id, { src: element.getAttribute('src') ?? '', state: {
        currentTime: element.currentTime, volume: element.volume,
      } })
    },
    getAudio(id: string, src: string) {
      const saved = audio.get(id)
      return saved?.src === src ? saved.state : undefined
    },
    prune(ids: ReadonlySet<string>) {
      let changed = false
      for (const id of reasons.keys()) if (!ids.has(id)) { reasons.delete(id); changed = true }
      for (const id of audio.keys()) if (!ids.has(id)) audio.delete(id)
      if (changed) notify(reasons)
    },
  }
}

export type TaskListRetention = ReturnType<typeof createRetention>
export const TaskListRetentionContext = createContext<TaskListRetention | null>(null)

export function useTaskListRetention(ids: readonly string[]): {
  retention: TaskListRetention
  retained: Array<{ id: string; focused: boolean }>
} {
  const [retained, setRetained] = useState<Array<{ id: string; focused: boolean }>>([])
  const retention = useMemo(() => createRetention(reasons => {
    setRetained([...reasons].map(([id, current]) => ({ id, focused: current.has('focus') })))
  }), [])
  useEffect(() => retention.prune(new Set(ids)), [ids, retention])
  useEffect(() => {
    const releasePointer = () => retention.clearReason('pointer')
    // 菜单动作先执行，再释放菜单宿主；异步收藏可在此期间接管保留原因。
    const releaseContext = () => retention.clearReason('context')
    window.addEventListener('mouseup', releasePointer)
    window.addEventListener('pointercancel', releasePointer)
    window.addEventListener('dragend', releasePointer)
    window.addEventListener('click', releaseContext)
    return () => {
      window.removeEventListener('mouseup', releasePointer)
      window.removeEventListener('pointercancel', releasePointer)
      window.removeEventListener('dragend', releasePointer)
      window.removeEventListener('click', releaseContext)
    }
  }, [retention])
  return { retention, retained }
}
