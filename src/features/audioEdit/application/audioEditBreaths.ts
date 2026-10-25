import type { AudioBreath } from '@/core/audioAnalysis/breath/respiro'
import { describeAudioEditBreaths, type AudioEditBreathView } from '@/core/audioEdit/breaths'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { getPlatform } from '@/platform/runtime'

/*
 * 口播的呼吸声：主进程按素材内容缓存检测结果，这里再按“口播 + 原素材”缓存一份，
 * 列实体、读写单口气、批量处理反复用到时不来回跨进程。检测失败不缓存，下次重试。
 */
const cache = new Map<string, Promise<AudioBreath[]>>()

const keyOf = (document: AudioEditProjectDocument): string => `${document.id}\u0000${document.source.identity?.digest ?? document.source.sourcePath}\u0000${document.source.durationFrames}`

export function loadAudioEditBreaths(document: AudioEditProjectDocument): Promise<AudioBreath[]> {
  const key = keyOf(document)
  let pending = cache.get(key)
  if (!pending) {
    pending = getPlatform().audioEdit.detectBreaths(document.id).then((detection) => detection.breaths)
    cache.set(key, pending)
    void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key) })
  }
  return pending
}

export async function loadAudioEditBreathViews(document: AudioEditProjectDocument): Promise<AudioEditBreathView[]> {
  return describeAudioEditBreaths(document, await loadAudioEditBreaths(document))
}
