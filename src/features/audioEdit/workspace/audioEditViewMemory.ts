/**
 * 每份口播上次停在哪：播放头位置与编辑器的缩放范围。只记在本机，不写进工程文件、不算修改；
 * 读不到（隐私模式、存储被清）时就从头打开。
 */
const STORAGE_KEY = 'henji.audioEdit.viewMemory.v1'
const MAX_DOCUMENTS = 50

export interface AudioEditViewMemory { start: number; end: number; playhead: number }
type Stored = Record<string, AudioEditViewMemory & { at: number }>

function readAll(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Stored : {}
  } catch { return {} }
}

export function readAudioEditViewMemory(documentId: string, durationFrames: number): AudioEditViewMemory | null {
  const item = readAll()[documentId]
  if (!item || ![item.start, item.end, item.playhead].every(Number.isFinite)) return null
  if (item.start < 0 || item.end <= item.start || item.end > durationFrames || item.playhead < 0 || item.playhead > durationFrames) return null
  return { start: item.start, end: item.end, playhead: item.playhead }
}

export function writeAudioEditViewMemory(documentId: string, memory: AudioEditViewMemory): void {
  try {
    const all = readAll()
    all[documentId] = { ...memory, at: Date.now() }
    const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_DOCUMENTS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch { /* 本机存不下时只是不记位置 */ }
}
