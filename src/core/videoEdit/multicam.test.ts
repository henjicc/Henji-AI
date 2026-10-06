import { expect, it } from 'vitest'
import { createVideoEditDocument, videoEditComposition, videoEditDocumentSchema } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTrim } from './timelineTrims'
import { applyVideoEditMulticamCuts, changeVideoEditMulticamCamera, createVideoEditMulticam, suggestVideoEditMulticamCuts, videoEditMulticamComposition } from './multicam'
import { videoEditAudioOffset, videoEditMulticamDownsample } from './multicamSync'

function fixture() {
  const document = createVideoEditDocument('多机位')
  document.media = ['a', 'b'].map(id => ({ id: `media-${id}`, name: id, path: `D:/${id}.mp4`, kind: 'video', width: 1920, height: 1080, durationSeconds: 20, hasAudio: true }))
  document.items = document.media.map(media => ({ id: media.name, name: media.name, kind: 'video', mediaId: media.id }))
  const result = createVideoEditMulticam(document, document.sequences[0].id, { name: '同步', sync: 'in_points', cameras: [{ itemId: 'a' }, { itemId: 'b' }], audioCameraIndex: 0 })
  const parent = result.document.sequences[0]; const clip = makeVideoEditItemClip(result.document, result.itemId, parent.id, { frame: 0, duration: 300 })
  parent.clips = [clip]
  return { document: result.document, parentId: parent.id, source: result.sequence, clip, cameras: result.sequence.multicam!.cameras }
}
function noise(size: number, seed = 7159): Float32Array {
  let state = seed
  return Float32Array.from({ length: size }, () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return state / 2 ** 31 })
}
it('FFT互相关已知正负偏移、增益/DC/反相，误差不超过一帧', () => {
  const samples = noise(90000)
  const later = Float32Array.from(samples.slice(2713), value => -.3 * value + .05)
  const actual = videoEditAudioOffset(samples, later)
  expect(Math.abs(actual.seconds - 2.713)).toBeLessThanOrEqual(1 / 60)
  expect(actual.confidence).toBeGreaterThan(.99)
  expect(Math.abs(videoEditAudioOffset(later, samples).seconds + 2.713)).toBeLessThanOrEqual(1 / 60)
  const delayed = new Float32Array(samples.length + 1541); delayed.set(samples, 1541)
  expect(Math.abs(videoEditAudioOffset(samples, delayed).seconds + 1.541)).toBeLessThanOrEqual(1 / 60)
})
it('降采样抑制高频后保留1kHz绝对时钟，反相立体声不抵消', () => {
  const samples = noise(2000); const full = Float32Array.from({ length: samples.length * 48 }, (_, index) => samples[Math.floor(index / 48)])
  const reduced = videoEditMulticamDownsample([full, Float32Array.from(full, value => -value)], 48000)
  expect(reduced.length).toBe(2000); expect(reduced[173]).toBeCloseTo(samples[173], 6)
  expect(() => videoEditAudioOffset(new Float32Array(2000), samples)).toThrow('静音')
  expect(() => videoEditAudioOffset(samples, noise(2000, 8219))).toThrow('可靠')
  const tone = Float32Array.from({ length: 2000 }, (_, index) => Math.sin(index * Math.PI / 10))
  expect(() => videoEditAudioOffset(tone, tone)).toThrow('多个')
  expect(() => videoEditAudioOffset(Float32Array.from({ length: 2000 }, () => Number.NaN), samples)).toThrow('无效')
})
it('音频、入点、时间码偏移统一为每机位一轨，保留子剪辑范围与主音频', () => {
  const value = fixture(); const base = value.document
  base.items[0].sourceRange = { inUs: 1000000, outUs: 11000000 }
  const options = { name: '新同步', cameras: [{ itemId: 'a', inPointSeconds: 3, timecodeSeconds: 100 }, { itemId: 'b', inPointSeconds: 4, timecodeSeconds: 105 }], sync: 'in_points' as const }
  const points = createVideoEditMulticam(base, value.parentId, options).sequence
  expect(points.clips.map(clip => clip.start)).toEqual([60, 0]); expect(points.clips[0]).toMatchObject({ sourceInUs: 1000000, duration: 300 })
  expect(createVideoEditMulticam(base, value.parentId, { ...options, sync: 'timecode' }).sequence.clips.map(clip => clip.start)).toEqual([0, 120])
  expect(createVideoEditMulticam(base, value.parentId, { ...options, sync: 'audio' }, [0, -2]).sequence.clips.map(clip => clip.start)).toEqual([60, 0])
})
it('播放切换建立连续机位段；换一段不改入点，滚动编辑保持声音与源时钟', () => {
  const value = fixture(); const { cameras, clip, parentId } = value
  const next = changeVideoEditMulticamCamera(value.document, parentId, clip.id, cameras[1].id, 90)
  value.document.sequences[0] = next
  expect(next.clips.map(clip => [clip.start, clip.duration, clip.sourceInUs])).toEqual([[0, 90, 0], [90, 210, 3000000]])
  const rolled = applyVideoEditTrim(value.document, parentId, { mode: 'roll', clipIds: [clip.id], edge: 'out', delta: 15 }).sequence
  expect(rolled.clips.map(clip => [clip.start, clip.duration, clip.sourceInUs])).toEqual([[0, 105, 0], [105, 195, 3500000]])
  value.document.sequences[0] = rolled
  expect(videoEditDocumentSchema.parse(value.document).sequences[0].clips[1].multicamCameraId).toBe(cameras[1].id)
  const changed = changeVideoEditMulticamCamera(value.document, parentId, rolled.clips[1].id, cameras[0].id)
  expect(changed.clips[1]).toMatchObject({ sourceInUs: 3500000, duration: 195, multicamCameraId: cameras[0].id })
})
it('自动切换含返回初始机位，完整分段，拒绝锁轨、错机位和乱序', () => {
  const value = fixture(); const cuts = [{ frame: 0, cameraId: value.cameras[0].id }, { frame: 60, cameraId: value.cameras[1].id }, { frame: 180, cameraId: value.cameras[0].id }]
  const next = applyVideoEditMulticamCuts(value.document, value.parentId, value.clip.id, cuts)
  expect(next.clips.map(clip => [clip.start, clip.duration, clip.multicamCameraId])).toEqual([[0, 60, cuts[0].cameraId], [60, 120, cuts[1].cameraId], [180, 120, cuts[2].cameraId]])
  expect(() => applyVideoEditMulticamCuts(value.document, value.parentId, value.clip.id, [cuts[0], cuts[2], cuts[1]])).toThrow('排列')
  expect(() => changeVideoEditMulticamCamera(value.document, value.parentId, value.clip.id, 'missing')).toThrow('机位')
  value.document.sequences[0].tracks.find(track => track.index === value.clip.track)!.locked = true
  expect(() => applyVideoEditMulticamCuts(value.document, value.parentId, value.clip.id, cuts)).toThrow('锁')
})
it('建议按活动/音量加最短镜头与滞回，静音/相等保持；说话人映射不猜身份', () => {
  const cameras = ['a', 'b'].map((cameraId, index) => ({ cameraId, speaker: cameraId, activity: [{ startSeconds: 0, endSeconds: 8 }], levels: [{ startSeconds: 0, endSeconds: 4, rms: index === 0 ? .2 : .8 }, { startSeconds: 4, endSeconds: 8, rms: index === 0 ? .8 : .2 }] }))
  expect(suggestVideoEditMulticamCuts(300, 30, 'a', cameras)).toEqual([{ frame: 0, cameraId: 'a' }, { frame: 60, cameraId: 'b' }, { frame: 120, cameraId: 'a' }])
  expect(suggestVideoEditMulticamCuts(300, 30, 'a', cameras.map(camera => ({ ...camera, levels: camera.levels.map(level => ({ ...level, rms: .5 })) })))).toEqual([{ frame: 0, cameraId: 'a' }])
  expect(suggestVideoEditMulticamCuts(300, 30, 'a', cameras, 2, [{ startSeconds: 0, endSeconds: 5, speaker: 'b' }])).toEqual([{ frame: 0, cameraId: 'a' }, { frame: 60, cameraId: 'b' }])
  expect(() => suggestVideoEditMulticamCuts(300, 30, 'a', cameras, 2, [{ startSeconds: 0, endSeconds: 5, speaker: 'missing' }])).toThrow('对应机位')
})
it('预览/导出逐段只渲染所选机位；主音频不会随画面切换', () => {
  const value = fixture(); const second = { ...value.clip, multicamCameraId: value.cameras[1].id }
  const a = videoEditMulticamComposition(value.document, value.parentId, value.clip)!
  const b = videoEditMulticamComposition(value.document, value.parentId, second)!
  expect(a.clips.filter(clip => clip.kind === 'video').map(clip => clip.itemId)).toEqual(['a'])
  expect(b.clips.filter(clip => clip.kind === 'video').map(clip => clip.itemId)).toEqual(['b'])
  expect(a.clips.filter(clip => clip.kind === 'audio')).toEqual(b.clips.filter(clip => clip.kind === 'audio'))
  expect(videoEditComposition(value.document, value.parentId).sequences).toHaveLength(2)
  expect(() => videoEditDocumentSchema.parse({ ...value.document, sequences: value.document.sequences.map(sequence => sequence.id === value.parentId ? { ...sequence, clips: [{ ...second, multicamCameraId: 'foreign' }] } : sequence) })).toThrow('不属于')
})
