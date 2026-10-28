import { describe, expect, it } from 'vitest'
import { parseCodeSceneSchema, validateCodeSceneRecords } from './sceneDeclaration'
import { videoEditSceneAnchorAt, videoEditSceneLaneEdges, videoEditSceneLanes, videoEditSceneLaneVisibleItems, type VideoEditSceneLaneGroup, type VideoEditSceneLanes } from './sceneLanes'
import { resolveVideoEditScene, type ResolvedVideoEditScene } from './sceneResolve'
import type { VideoEditScene, VideoEditSceneRecord } from './sceneSchema'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from './sceneTestFixtures'

const schema = parseCodeSceneSchema({
  ...GOLDEN_SCENE_DECLARATION,
  kinds: {
    ...GOLDEN_SCENE_DECLARATION.kinds,
    window: {
      ...GOLDEN_SCENE_DECLARATION.kinds.window, at: 'at', end: 'until', influence: 'span', lane: { style: 'row', label: 'name' },
      fields: { ...GOLDEN_SCENE_DECLARATION.kinds.window.fields, at: { type: 'time' }, until: { type: 'time' } },
    },
    focus: { ...GOLDEN_SCENE_DECLARATION.kinds.focus, at: 'at', end: 'end', influence: 'span', fields: { ...GOLDEN_SCENE_DECLARATION.kinds.focus.fields, at: { type: 'time' }, end: { type: 'time' } } },
    note: { at: 'at', end: 'end', influence: 'span', lane: { style: 'block', label: 'name' }, fields: { name: { type: 'text', maxLength: 80 }, at: { type: 'time' }, end: { type: 'time' } } },
    empty: { at: 'at', influence: 'neighbors', lane: { style: 'key' }, fields: { at: { type: 'time' } } },
    plainCut: { at: 'at', end: 'end', influence: 'span', lane: { style: 'cut' }, fields: { at: { type: 'time' }, end: { type: 'time' } } },
  },
})
const media = new Map([['screen', 'video' as const]])
const scene = (records: VideoEditSceneRecord[]): VideoEditScene => ({ id: 'film', name: '元宝搜索', schema: { id: schema.id, version: schema.version }, records })
const resolve = (records: VideoEditSceneRecord[], duration = 400): ResolvedVideoEditScene => {
  const data = scene(records)
  expect(validateCodeSceneRecords(schema, data, { media })).toEqual([])
  return resolveVideoEditScene(data, schema, { media, duration })
}
const group = (lanes: VideoEditSceneLanes, kind: string): VideoEditSceneLaneGroup => lanes.groups.find(value => value.kind === kind)!
const window = (id: string, at: number, until: number): VideoEditSceneRecord => ({ id, kind: 'window', values: { name: id, media: 'screen', rect: { x: 0, y: 0, width: 800, height: 600 }, at, until } })
const shot = (id: string, parent: string, at: number, src = 0, rate = 1): VideoEditSceneRecord => ({ id, kind: 'shot', parent, values: { at, src, rate, media: 'screen' } })
const focus = (id: string, at: number, end: number): VideoEditSceneRecord => ({ id, kind: 'focus', values: { name: id, at, end } })
const key = (id: string, parent: string, win: string, at: number | { src: number }): VideoEditSceneRecord => ({ id, kind: 'focusKey', parent, values: { at, dur: 0.5, win, target: { x: 0, y: 0, width: 1, height: 1 } } })
const note = (id: string, at: number, end: number): VideoEditSceneRecord => ({ id, kind: 'note', values: { name: id, at, end } })
const cut = (from: number, to: number, enabled = true, id = 'cut'): VideoEditSceneRecord => ({ id, kind: 'cut', values: { from, to, enabled } })

describe('片子数据时间线子轨道', () => {
  it('复用一期黄金样例，按声明顺序成组；无 lane 与空类型不显示', () => {
    const declaration = parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION)
    const resolved = resolveVideoEditScene(goldenScene('screen'), declaration, { duration: 5 })
    const lanes = videoEditSceneLanes(resolved)
    expect(lanes.groups.map(value => value.kind)).toEqual(['segment', 'shot', 'focusKey', 'cut'])
    const segment = group(lanes, 'segment').rows[0].items[0]
    expect(segment.label).toBe('交换机')
    expect(segment.record).toBe(resolved.byId.get('seg-switch'))
    expect([segment.at, segment.end]).toEqual([0.5, 2.5])
    expect(videoEditSceneLanes(resolved)).toBe(lanes)
    expect(videoEditSceneLaneEdges(resolved)).toBe(lanes.edges)
    expect(videoEditSceneLanes({ ...resolved })).not.toBe(lanes)
  })

  it('窗口各占一行，shot 嵌入父行；跨剪切的几个取帧段按来源聚合成一个块', () => {
    const resolved = resolve([
      window('w1', 290, 340), shot('s1', 'w1', 290), shot('s2', 'w1', 330, 100),
      window('w2', 300, 325), shot('s3', 'w2', 300, 200), cut(306.1833, 316.7533),
    ])
    const lanes = videoEditSceneLanes(resolved)
    expect(lanes.groups.map(value => value.kind)).toEqual(['window', 'cut'])
    const rows = group(lanes, 'window').rows
    expect(rows.map(row => row.record?.id)).toEqual(['w1', 'w2'])
    const block = rows[0].items.find(item => item.record.id === 's1')!
    expect(block.style).toBe('block')
    expect(block.at).toBe(290)
    expect(block.end).toBeCloseTo(319.43, 9)
    expect(block.shots).toHaveLength(2)
    expect(block.shots[1].at).toBeCloseTo(306.1833, 9)
    expect(block.shots[1].src).toBeCloseTo(26.7533, 9)
    expect(rows[0].items.filter(item => item.record.id === 's1')).toHaveLength(1)
    expect(rows[1].items.map(item => item.record.id)).toContain('s3')
  })

  it('key 按所属 focus 分行，保留父区间，其他类型按区间贪心打包', () => {
    const resolved = resolve([
      window('w', 0, 30), shot('s', 'w', 0), focus('f1', 1, 15), focus('f2', 5, 20),
      key('k2', 'f1', 'w', 8), key('k1', 'f1', 'w', 2), key('k3', 'f2', 'w', 9),
      note('n3', 4, 7), note('n1', 0, 4), note('n2', 2, 5),
    ])
    const lanes = videoEditSceneLanes(resolved)
    expect(lanes.groups.map(value => value.kind)).toEqual(['window', 'focusKey', 'note'])
    const keys = group(lanes, 'focusKey').rows
    expect(keys.map(row => [row.record?.id, row.at, row.end, row.items.map(item => item.record.id)])).toEqual([
      ['f1', 1, 15, ['k1', 'k2']], ['f2', 5, 20, ['k3']],
    ])
    expect(group(lanes, 'note').rows.map(row => row.items.map(item => item.record.id))).toEqual([['n1', 'n3'], ['n2']])
  })

  it('生效剪切是零宽标记，停用剪切保留区间；显示样式本身不产生剪切语义', () => {
    const resolved = resolve([cut(306.1833, 316.7533), cut(324.83, 333.28, false, 'disabled'), { id: 'plain', kind: 'plainCut', values: { at: 280, end: 285 } }])
    const lanes = videoEditSceneLanes(resolved)
    const items = group(lanes, 'cut').rows.flatMap(row => row.items)
    const enabled = items.find(item => item.record.id === 'cut')!
    expect([enabled.at, enabled.end]).toEqual([306.1833, 306.1833])
    expect(enabled.cut?.removedDuration).toBeCloseTo(10.57, 9)
    expect(enabled.cut?.position).toBe(306.1833)
    const disabled = items.find(item => item.record.id === 'disabled')!
    expect(disabled.at).toBeCloseTo(314.26, 9)
    expect(disabled.end).toBeCloseTo(322.71, 9)
    expect(disabled.cut).toMatchObject({ enabled: false, from: 324.83, to: 333.28, removedDuration: 0 })
    const plain = group(lanes, 'plainCut').rows[0].items[0]
    expect([plain.at, plain.end, plain.cut]).toEqual([280, 285, undefined])
    const restored = videoEditSceneLanes(resolve([cut(306.1833, 316.7533, false)]))
    expect(group(restored, 'cut').rows[0].items[0]).toMatchObject({ at: 306.1833, end: 316.7533 })
  })

  it('重叠与多刀剪切在实际剪切口标记，长度仍可按来源读回', () => {
    const resolved = resolve([cut(4, 6, true, 'a'), cut(5, 8, true, 'b'), cut(12, 14, true, 'c')])
    const items = group(videoEditSceneLanes(resolved), 'cut').rows.flatMap(row => row.items)
    expect(items.map(item => [item.record.id, item.at, item.end])).toEqual([['a', 4, 4], ['b', 4, 4], ['c', 8, 8]])
    expect(videoEditSceneLaneEdges(resolved)).toEqual([4, 8])
  })

  it('夹取入出点，整条在外的也留在边缘；吸附边缘去重且排序，范围缓存不依赖参数对象身份', () => {
    const resolved = resolve([note('left', 0, 5), note('middle', 8, 22), note('right', 25, 30)])
    const range = { from: 10, to: 20 }
    const lanes = videoEditSceneLanes(resolved, range)
    const items = group(lanes, 'note').rows.flatMap(row => row.items)
    expect(items.map(item => [item.record.id, item.at, item.end])).toEqual([['left', 10, 10], ['middle', 10, 20], ['right', 20, 20]])
    expect(items.find(item => item.record.id === 'left')?.clippedStart).toBe(true)
    expect(items.find(item => item.record.id === 'middle')).toMatchObject({ clippedStart: true, clippedEnd: true })
    expect(items.find(item => item.record.id === 'right')?.clippedEnd).toBe(true)
    expect(lanes.edges).toEqual([10, 20])
    expect(videoEditSceneLanes(resolved, { from: 10, to: 20 })).toBe(lanes)
    range.from = 11
    expect(videoEditSceneLanes(resolved, range)).not.toBe(lanes)
    expect(videoEditSceneLanes(resolved, { from: 10, to: 20 })).toBe(lanes)
    expect(videoEditSceneLanes(resolved).edges).toEqual([0, 5, 8, 22, 25, 30])
  })

  it('解析问题按记录引用附在条目上，不混入别条记录的问题', () => {
    const resolved = resolve([window('w', 0, 600), ...Array.from({ length: 520 }, (_, index) => shot(`s${index}`, 'w', index, index))], 600)
    const row = group(videoEditSceneLanes(resolved), 'window').rows[0]
    expect(row.items.find(item => item.record.id === 'w')?.issues).toEqual(resolved.issues)
    expect(row.items.find(item => item.record.id === 's0')?.issues).toEqual([])
    expect(row.items.find(item => item.record.id === 'w')?.issues[0]).toBe(resolved.issues[0])
  })

  it('可见查询覆盖重叠父条、长块、闭区间边界和零宽点，与线性查询一致', () => {
    const resolved = resolve([window('w', 0, 30), shot('s1', 'w', 0), shot('s2', 'w', 10, 100), shot('s3', 'w', 20, 200), cut(4, 6)])
    const lanes = videoEditSceneLanes(resolved)
    const row = group(lanes, 'window').rows[0]
    for (const [from, to] of [[-10, -1], [0, 0], [4, 4], [8, 8], [9, 19], [27, 100], [100, 200]]) {
      expect(videoEditSceneLaneVisibleItems(row, from, to)).toEqual(row.items.filter(item => item.at <= to && item.end >= from))
    }
    const cutRow = group(lanes, 'cut').rows[0]
    expect(videoEditSceneLaneVisibleItems(cutRow, 4, 4)).toEqual(cutRow.items)
    expect(videoEditSceneLaneVisibleItems(row, 2, 1)).toEqual([])
  })

  it('四百条记录生成与窗口查询在宽松耗时预算内完成，开放结尾不会产生无限吸附边缘', () => {
    const resolved = resolve(Array.from({ length: 400 }, (_, index) => note(`n${index}`, index, index + 0.75)))
    const start = performance.now()
    const lanes = videoEditSceneLanes(resolved)
    const row = group(lanes, 'note').rows[0]
    expect(row.items).toHaveLength(400)
    expect(videoEditSceneLaneVisibleItems(row, 200, 210)).toHaveLength(11)
    expect(performance.now() - start).toBeLessThan(1000)
    const open = resolveVideoEditScene(goldenScene('screen'), parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION))
    expect(videoEditSceneLaneEdges(open).every(Number.isFinite)).toBe(true)
  })
})

describe('录屏秒锚定反解', () => {
  it('复用黄金样例的 footage 引用，反解后通过正式解析器回到原时刻', () => {
    const declaration = parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION)
    const data = goldenScene('screen')
    const resolved = resolveVideoEditScene(data, declaration, { duration: 5 })
    const record = resolved.byId.get('fk-1')!
    const result = videoEditSceneAnchorAt(resolved, record, 1.1)
    expect(result).toEqual({ ok: true, anchor: { src: 1.1 } })
    if (!result.ok) return
    const updated = { ...data, records: data.records.map(value => value === record.source ? { ...value, values: { ...value.values, at: result.anchor } } : value) }
    expect(resolveVideoEditScene(updated, declaration, { duration: 5 }).byId.get(record.id)?.at).toBeCloseTo(1.1, 9)
    expect(record.source.values.at).toEqual({ src: 0.8 })
  })

  it('跨 306.18–316.75 剪切后按保留的 shot 求源秒，不把剪后有效画面误当作未剪区间', () => {
    const resolved = resolve([window('w', 290, 340), shot('s', 'w', 290, 10, 2), focus('f', 290, 340), key('k', 'f', 'w', { src: 12 }), cut(306.1833, 316.7533)])
    const record = resolved.byId.get('k')!
    const result = videoEditSceneAnchorAt(resolved, record, 307)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.anchor.src).toBeCloseTo(65.14, 9)
    const seam = videoEditSceneAnchorAt(resolved, record, 306.1833)
    expect(seam.ok).toBe(true)
    if (seam.ok) expect(seam.anchor.src).toBeCloseTo(63.5066, 9)
  })

  it('落进剪切的退场区域没有可写回画面时明确拒绝；停帧中途与第二次播放无法伪装成唯一锚定', () => {
    const resolved = resolve([
      window('w', 0, 5), shot('s', 'w', 0, 10, 0), focus('f', 0, 20), key('k', 'f', 'w', { src: 10 }), cut(4, 6),
    ])
    const record = resolved.byId.get('k')!
    expect(videoEditSceneAnchorAt(resolved, record, 4.5)).toMatchObject({ ok: false, reason: 'cut' })
    expect(videoEditSceneAnchorAt(resolved, record, 1)).toMatchObject({ ok: false, reason: 'unrepresentable' })
    expect(videoEditSceneAnchorAt(resolved, record, 0)).toEqual({ ok: true, anchor: { src: 10 } })
    const repeated = resolve([window('w', 0, 20), shot('s1', 'w', 0), shot('s2', 'w', 10), focus('f', 0, 20), key('k', 'f', 'w', 1)])
    expect(videoEditSceneAnchorAt(repeated, repeated.byId.get('k')!, 12)).toMatchObject({ ok: false, reason: 'unrepresentable' })
  })

  it('窗口 ref 与段落作用域由正式解析器决定，另一窗口同时播放同一素材不混淆', () => {
    const segment: VideoEditSceneRecord = { id: 'seg', kind: 'segment', values: { name: '段落', start: 10, end: 20 } }
    const scopedSchema = parseCodeSceneSchema({ ...schema, kinds: { ...schema.kinds, focus: { ...schema.kinds.focus, parent: ['segment'] } } })
    const records = [segment, window('other', 0, 30), shot('other-shot', 'other', 0, 100), window('w', 10, 20), shot('s', 'w', 10, 50), { ...focus('f', 10, 20), parent: 'seg' }, key('k', 'f', 'w', { src: 51 })]
    const resolved = resolveVideoEditScene(scene(records), scopedSchema, { media })
    expect(videoEditSceneAnchorAt(resolved, resolved.byId.get('k')!, 12)).toEqual({ ok: true, anchor: { src: 52 } })
    expect(videoEditSceneAnchorAt(resolved, resolved.byId.get('k')!, 5)).toMatchObject({ ok: false, reason: 'unrepresentable' })
  })

  it('无效时刻、不能锚定的类型和其他解析对象的记录都返回拒绝结果', () => {
    const resolved = resolve([note('n', 0, 10), window('w', 0, 20), shot('s', 'w', 0), focus('f', 0, 20), key('k', 'f', 'w', 1)])
    const record = resolved.byId.get('k')!
    for (const t of [-1, NaN, Infinity]) expect(videoEditSceneAnchorAt(resolved, record, t)).toMatchObject({ ok: false, reason: 'invalid-time' })
    expect(videoEditSceneAnchorAt(resolved, resolved.byId.get('n')!, 1)).toMatchObject({ ok: false, reason: 'not-anchorable' })
    expect(videoEditSceneAnchorAt(resolved, { ...record }, 1)).toMatchObject({ ok: false, reason: 'not-anchorable' })
  })
  it('窗口内容条目给出同一张时间表里的下一项（停多久的结束），最后一项没有', () => {
    const resolved = resolveVideoEditScene(goldenScene('screen'), parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION), { duration: 5 })
    const items = group(videoEditSceneLanes(resolved), 'shot').rows.flatMap(row => row.items)
    const first = items.find(value => value.record.id === 'sh-1')!, last = items.find(value => value.record.id === 'sh-2')!
    expect(first.next?.record).toBe(resolved.byId.get('sh-2'))
    expect(first.next?.at).toBe(1.5)
    expect(last.next).toBeUndefined()
  })
})
