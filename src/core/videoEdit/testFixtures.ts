import { createVideoEditDocument, createVideoEditSequence, type VideoEditDocument, type VideoEditSequence } from './document'

/**
 * 测试夹具：补齐旧版默认的八条轨道（A1 + V1–V7，编号 0–7）。新序列与 PR 一样只有 V1/A1（剪辑对齐 PR 2.4），
 * 需要多条视频轨的编辑测试用它显式加轨。原地修改并返回同一序列。
 */
export function addLegacyVideoEditTracks<T extends Pick<VideoEditSequence, 'tracks'>>(sequence: T): T {
  const template = sequence.tracks.find(track => track.kind === 'video') ?? sequence.tracks[0]
  for (let index = 1; index < 8; index++) {
    if (sequence.tracks.some(track => track.index === index)) continue
    sequence.tracks.push({ ...template, id: crypto.randomUUID(), name: `视频 ${index}`, index, kind: 'video', locked: false, enabled: true, muted: false, solo: false })
  }
  return sequence
}

/** 编辑用例显式创建时间线；生产新项目始终为零时间线。保留用例明确使用的30帧规格。 */
export function createVideoEditTestDocument(name: string): VideoEditDocument {
  const document = createVideoEditDocument(name)
  document.sequences.push(createVideoEditSequence())
  return document
}
