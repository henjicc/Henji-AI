import { expect, it } from 'vitest'
import { audioEditGainDiff, audioEditSoundDescriptionSchema, diffAudioEditSound, mapAudioEditFramesThroughSplice, mapAudioEditSoundThroughSplice, type AudioEditSoundDescription, type AudioEditSoundOp } from './sound-diff'

const sound = (ops: AudioEditSoundOp[]): AudioEditSoundDescription => ({ source: 's', frames: 1_000_000, ops })
const repair = (start: number, end: number): AudioEditSoundOp => ({ key: `repair:${start}`, kind: 'local', recipe: `repair:${start}`, write: [start, end], context: 2560 })
const gains = (...regions: Array<[number, number, number]>): AudioEditSoundOp => ({ key: 'gains', kind: 'gain', regions: regions.map(([start, end, db]) => [start, end, db, 0, 0]) })

it('音量区域只在“覆盖这一帧的区域序列”变了的地方不同，包括同起点区域的先后', () => {
  expect(audioEditGainDiff([[0, 100, -6, 0, 0]], [[0, 100, -6, 0, 0]])).toEqual([])
  expect(audioEditGainDiff([[0, 100, -6, 0, 0]], [[0, 100, -6, 0, 0], [500, 600, -3, 0, 0]])).toEqual([[500, 600]])
  // 区域本身变了（终点决定淡出）：它覆盖的帧都算不同；没被它覆盖的另一段不动
  expect(audioEditGainDiff([[0, 100, -6, 0, 0], [300, 400, -3, 0, 0]], [[0, 120, -6, 0, 0], [300, 400, -3, 0, 0]])).toEqual([[0, 120]])
  // 乘法先后不同也算不同（单精度舍入不交换）
  expect(audioEditGainDiff([[0, 100, -6, 0, 0], [0, 100, -3, 0, 0]], [[0, 100, -3, 0, 0], [0, 100, -6, 0, 0]])).toEqual([[0, 100]])
})

it('局部修复只在上游改动落进它的取样范围时重算自己的选区；整段效果遇到上游改动或参数变化就整段', () => {
  const before = sound([repair(10_000, 12_000), repair(400_000, 401_000), gains([700_000, 710_000, -6])])
  // 加一处修复：只多出它自己的选区，后面的修复取样范围没碰到
  expect(diffAudioEditSound(before, sound([repair(10_000, 12_000), repair(14_000, 15_000), repair(400_000, 401_000), gains([700_000, 710_000, -6])]))).toEqual({ ranges: [[14_000, 15_000]] })
  // 删掉第一处修复，紧挨着它（2560 帧以内）的后一处修复要重算
  const near = sound([repair(10_000, 12_000), repair(13_000, 13_500)])
  expect(diffAudioEditSound(near, sound([repair(13_000, 13_500)]))).toEqual({ ranges: [[10_000, 12_000], [13_000, 13_500]] })
  const global: AudioEditSoundOp = { key: 'item:eq', kind: 'global', recipe: 'eq-1' }
  expect(diffAudioEditSound(sound([global, gains([0, 10, -1])]), sound([global, gains([0, 10, -2])]))).toEqual({ ranges: [[0, 10]] })
  expect(diffAudioEditSound(sound([repair(0, 10), global]), sound([global]))).toMatchObject({ all: expect.stringContaining('上游') })
  expect(diffAudioEditSound(sound([global]), sound([{ ...global, recipe: 'eq-2' }]))).toMatchObject({ all: expect.stringContaining('参数') })
  expect(diffAudioEditSound(sound([]), { ...sound([]), source: 'other' })).toMatchObject({ all: expect.any(String) })
})

it('口水音：改动的段与取样窗被波及的段要重算，远处的段沿用', () => {
  const clicks = (ranges: Array<[number, number]>): AudioEditSoundOp => ({ key: 'item:clicks', kind: 'clicks', ranges, margin: 8192 })
  const before = sound([clicks([[10_000, 10_100], [15_000, 15_100], [500_000, 500_100]])])
  expect(diffAudioEditSound(before, sound([clicks([[10_000, 10_100], [500_000, 500_100]])]))).toEqual({ ranges: [[10_000, 10_100], [15_000, 15_100]] })
  // 上游修复改到了某段两侧的取样窗
  expect(diffAudioEditSound(sound([repair(20_000, 20_500), clicks([[15_000, 15_100], [500_000, 500_100]])]), sound([clicks([[15_000, 15_100], [500_000, 500_100]])])))
    .toEqual({ ranges: [[15_000, 15_100], [20_000, 20_500]] })
})

it('认不出或不合法的操作一律整段，不当成“没有这个操作”只重算部分帧', () => {
  const unknown = { key: 'item:future', kind: 'future', recipe: 'x' } as unknown as AudioEditSoundOp
  expect(diffAudioEditSound(sound([unknown]), sound([]))).toMatchObject({ all: expect.stringContaining('认不出') })
  expect(diffAudioEditSound(sound([unknown, gains([0, 10, -1])]), sound([unknown, gains([0, 10, -2])]))).toMatchObject({ all: expect.stringContaining('认不出') })
  // 落盘的上一版记录先过结构校验
  expect(audioEditSoundDescriptionSchema.safeParse(sound([unknown])).success).toBe(false)
  expect(audioEditSoundDescriptionSchema.safeParse(sound([repair(10, 5)])).success).toBe(false)
  expect(audioEditSoundDescriptionSchema.safeParse(sound([repair(10, 20), gains([0, 10, -6])])).success).toBe(true)
})

it('素材补录拼接后，上一版操作序列映射到新坐标：拼接点之前原样、之后平移，只有插入段和跨过拼接点、平移了位置的修复不同', () => {
  const before = sound([repair(10_000, 12_000), repair(600_000, 601_000), gains([100_000, 200_000, -6], [300_000, 350_000, -3], [700_000, 710_000, -6])])
  // 在 320000 处插入 50000 帧：第二个音量区被劈成两截（渲染层按 spliceAudioRanges 处理），后面的区域与修复整体后移
  const inserted = mapAudioEditSoundThroughSplice(before, { start: 320_000, end: 320_000, inserted: 50_000 }, { source: 't', frames: 1_050_000 })
  const after = { source: 't', frames: 1_050_000, ops: [repair(10_000, 12_000), repair(650_000, 651_000), gains([100_000, 200_000, -6], [300_000, 320_000, -3], [370_000, 400_000, -3], [750_000, 760_000, -6])] }
  expect(diffAudioEditSound(inserted.sound, after, inserted.dirty)).toEqual({ ranges: [[300_000, 400_000], [650_000, 651_000]] })
  // 等长替换：后段原位不动，修复照旧匹配，只有被替换段不同
  const replaced = mapAudioEditSoundThroughSplice(before, { start: 500_000, end: 520_000, inserted: 20_000 }, { source: 't', frames: 1_000_000 })
  expect(diffAudioEditSound(replaced.sound, { ...before, source: 't' }, replaced.dirty)).toEqual({ ranges: [[500_000, 520_000]] })
  // 整段处理的效果：来源有改动就整段
  const global: AudioEditSoundOp = { key: 'item:eq', kind: 'global', recipe: 'eq-1' }
  const withGlobal = mapAudioEditSoundThroughSplice(sound([global]), { start: 500_000, end: 520_000, inserted: 20_000 }, { source: 't', frames: 1_000_000 })
  expect(diffAudioEditSound(withGlobal.sound, { source: 't', frames: 1_000_000, ops: [global] }, withGlobal.dirty)).toMatchObject({ all: expect.stringContaining('上游') })
  // 多次拼接时前一次的不同帧随后一次平移
  expect(mapAudioEditFramesThroughSplice([[100, 200], [900, 1000]], { start: 500, end: 600, inserted: 10 })).toEqual([[100, 200], [810, 910]])
})
