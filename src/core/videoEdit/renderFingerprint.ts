import type { ResolvedVideoEditSceneRecord } from './scene/sceneResolve'

/** 两个不同种子的 53 位字符串散列拼成 106 位，足够区分同一工程里的窗口内容。 */
export function renderFingerprintHash(text: string): string {
  const one = (seed: number): string => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  return `${one(1)}${one(7)}`
}

/** 指纹失败按窗口回退；缺帧不能当成空画面。 */
export type VideoEditFrameFingerprint = { digest: string; fallback?: undefined; method?: 'frameKey' | 'recording' | 'simulation' } | { digest?: undefined; fallback: string; method?: undefined }
export interface VideoEditClipFingerprints { signature?: string; startFrame?: number; endFrame?: number; frames: ReadonlyMap<number, VideoEditFrameFingerprint> }
export type VideoEditCodeFingerprints = ReadonlyMap<string, VideoEditClipFingerprints>

const recordDigests = new WeakMap<ResolvedVideoEditSceneRecord, string>()
/** 按解析后的取值：剪切、锚定移动了记录时，它的时刻跟着变，落到哪一段就让哪一段失效。 */
export function renderSceneRecordFingerprint(record: ResolvedVideoEditSceneRecord): string {
  let digest = recordDigests.get(record)
  if (digest === undefined) { digest = renderFingerprintHash(JSON.stringify([record.id, record.kind, record.parent?.id ?? null, record.at ?? null, String(record.end), record.footage ?? null, record.values])); recordDigests.set(record, digest) }
  return digest
}
