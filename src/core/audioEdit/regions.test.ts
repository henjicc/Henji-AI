import { expect, it } from 'vitest'
import v1 from '../../../tests/fixtures/persistence/document.audio_edit/v1.json'
import v2 from '../../../tests/fixtures/persistence/document.audio_edit/v2.json'
import { audioEditDocumentKind } from '../documents/kinds/audioEdit'
import { upgradePersistenceContent } from '../persistence/migrations'
import { audioEditProjectFromDocument, audioEditProjectToDocumentContent } from './documentContent'
import { audioEditProjectSchema } from './schema'
import { hasAudioEditModifications, restoreAudioEditBaseline } from './baseline'
import { rasterAudioRepairMask } from './brushMask'
import { applyAudioEditGainRegions } from './regions'

const shell = { id: 'regions', name: '声音', createdAt: 1, updatedAt: 1, revision: 0 }
export const gain = { id: 'gain', startFrame: 0, endFrame: 24000, gainDb: -6, fadeInFrames: 100, fadeOutFrames: 100, enabled: true }
export const repair = { id: 'heal', kind: 'spectral_heal' as const, startFrame: 1000, endFrame: 2000, lowHz: 100, highHz: 2000, strength: .5, enabled: true, strokes: [{ radius: .1, points: [{ x: .1, y: .3 }, { x: .8, y: .3 }] }] }
it('v1 migrates without changing old audio edits; v2 regions survive document round-trip', () => {
  const before = JSON.stringify(v1.content)
  const content = upgradePersistenceContent({ id: 'document.audio_edit', name: '音频', version: 2, minReaderVersion: 1, schema: audioEditDocumentKind.contentSchema, migrations: audioEditDocumentKind.migrations }, v1.content, 1)
  expect(content).toEqual(v1.content); expect(JSON.stringify(v1.content)).toBe(before)
  const { project } = audioEditProjectFromDocument(shell, { ...content as object, gainRegions: [gain], repairs: [repair] })
  expect(audioEditProjectToDocumentContent(project)).toMatchObject({ gainRegions: [gain], repairs: [repair] })
  expect(hasAudioEditModifications(project)).toBe(true)
  expect(restoreAudioEditBaseline(project)).toMatchObject({ gainRegions: [], repairs: [] })
  expect(audioEditDocumentKind.isEmptyContent?.({ ...audioEditDocumentKind.createEmptyContent(), source: { ...v1.content.source, mediaType: 'audio' }, repairs: [repair] })).toBe(false)
  const golden = audioEditProjectFromDocument(shell, v2.content).project
  expect(audioEditProjectToDocumentContent(golden)).toMatchObject({ gainRegions: v2.content.gainRegions, repairs: v2.content.repairs })
})
it('rejects duplicate/out-of-source regions, invalid fades and frequencies', () => {
  const { project } = audioEditProjectFromDocument(shell, v1.content)
  for (const fields of [{ gainRegions: [gain, gain] }, { gainRegions: [{ ...gain, endFrame: 999999 }] }, { gainRegions: [{ ...gain, fadeInFrames: 24000 }] }, { repairs: [{ ...repair, highHz: 24001 }] }]) expect(audioEditProjectSchema.safeParse({ ...project, ...fields }).success).toBe(false)
})
it('brush strokes rasterize connected lines in low-frequency-first row order and stay bounded', () => {
  const bytes = rasterAudioRepairMask(repair.strokes, 100, 100)
  expect(bytes[30 * 100 + 40]).toBe(255); expect(bytes[70 * 100 + 40]).toBe(0)
  expect(() => rasterAudioRepairMask(repair.strokes, 100000, 100000)).toThrow('过大')
})
it('elliptical brush uses its own vertical radius', () => {
  const bytes = rasterAudioRepairMask([{ radius: .05, radiusY: .3, points: [{ x: .5, y: .5 }] }], 100, 100)
  expect(bytes[75 * 100 + 50]).toBe(255) // 0.25 above center: inside radiusY
  expect(bytes[50 * 100 + 60]).toBe(0) // 0.1 right of center: outside radius
  expect(bytes[50 * 100 + 53]).toBe(255)
})
it('音量区域上百个也逐帧正确相乘：淡入从静音渐入、淡出渐出到静音，重叠的相乘', () => {
  // 呼吸声快节奏处理常有上百处减弱；采样率 1000，两声道，按 1000 帧一块处理
  const regions = Array.from({ length: 150 }, (_, i) => ({ id: `g${i}`, startFrame: i * 100, endFrame: i * 100 + 60, gainDb: -18, fadeInFrames: 10, fadeOutFrames: 10, enabled: true }))
  regions.push({ id: 'all', startFrame: 0, endFrame: 15000, gainDb: -6, fadeInFrames: 0, fadeOutFrames: 0, enabled: true })
  const pcm = new Float32Array(15000 * 2).fill(1)
  for (let start = 0; start < 15000; start += 1000) applyAudioEditGainRegions(pcm.subarray(start * 2, (start + 1000) * 2), start, 2, regions)
  const half = 10 ** (-6 / 20), breath = 10 ** (-18 / 20)
  expect(pcm[2 * 7430]).toBeCloseTo(half * breath, 6) // 第 75 处区域中段，两个区域相乘
  expect(pcm[2 * 7430 + 1]).toBeCloseTo(half * breath, 6)
  expect(pcm[2 * 7400]).toBe(0) // 淡入第一帧从静音开始
  expect(pcm[2 * 7405]).toBeCloseTo(half * breath * 0.5, 6)
  expect(pcm[2 * 7480]).toBeCloseTo(half, 6) // 区域之外只剩整段 -6 dB
  expect(pcm[2 * 14959]).toBe(0) // 最后一处的淡出最后一帧到静音
})
