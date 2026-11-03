import { useSyncExternalStore } from 'react'
import type { VideoEditAudioLevel } from '../engine/videoEditAudioMeter'

/** 哪个监视器在出声：音频仪表面板显示最近一次有声音的那一个（参照 PR 的音频仪表）。 */
export type VideoEditPlaybackLevelSource = 'program' | 'source'
export interface VideoEditPlaybackLevels { source: VideoEditPlaybackLevelSource; levels: readonly VideoEditAudioLevel[] }

const EMPTY: VideoEditPlaybackLevels = { source: 'program', levels: [] }
const states = new Map<string, VideoEditPlaybackLevels>()
const listeners = new Map<string, Set<() => void>>()

/**
 * 监视器每 50 ms 写一次本剪辑的电平。另一个监视器正出声时，这个监视器的静音读数不覆盖它；
 * 读数没变就不通知（暂停时一直是零），面板不跟着重绘。
 */
export function setVideoEditPlaybackLevels(projectId: string, source: VideoEditPlaybackLevelSource, levels: readonly VideoEditAudioLevel[]): void {
  const current = states.get(projectId) ?? EMPTY
  const silent = levels.every(level => level.peak <= 0)
  if (current.source !== source && silent) return
  if (current.source === source && current.levels.length === levels.length && current.levels.every((level, index) => level.peak === levels[index].peak && level.rms === levels[index].rms)) return
  states.set(projectId, { source, levels })
  for (const listener of listeners.get(projectId) ?? []) listener()
}

export function useVideoEditPlaybackLevels(projectId: string): VideoEditPlaybackLevels {
  return useSyncExternalStore(listener => {
    let set = listeners.get(projectId)
    if (!set) { set = new Set(); listeners.set(projectId, set) }
    set.add(listener)
    return () => { set!.delete(listener); if (!set!.size) listeners.delete(projectId) }
  }, () => states.get(projectId) ?? EMPTY)
}
