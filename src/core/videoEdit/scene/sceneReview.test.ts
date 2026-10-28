import { describe, expect, it } from 'vitest'
import { parseCodeSceneSchema } from './sceneDeclaration'
import { resolveVideoEditScene } from './sceneResolve'
import { reviewVideoEditScene } from './sceneReview'
import type { VideoEditSceneRecord } from './sceneSchema'

const schema = parseCodeSceneSchema({ id: 'review', version: 1, kinds: {
  cut: { role: 'cut', at: 'from', end: 'to', fields: { from: { type: 'time' }, to: { type: 'time' } } },
  segment: { role: 'segment', at: 'at', end: 'end', fields: { at: { type: 'time' }, end: { type: 'time' } } },
  window: { parent: ['segment'], footage: 'media', fields: { media: { type: 'media' } } },
  shot: { parent: ['window'], role: 'shot', at: 'at', influence: 'untilNext', footage: 'media', fields: {
    at: { type: 'time' }, media: { type: 'media' }, src: { type: 'sourceTime' }, cursor: { type: 'boolean', default: true }, xf: { type: 'duration', optional: true }, rate: { type: 'number', min: 0, max: 16, default: 1 },
  } },
  box: { parent: ['segment'], footage: 'win', at: 'at', end: 'end', influence: 'span', fields: {
    win: { type: 'ref', to: ['window'] }, at: { type: 'time' }, end: { type: 'time' }, samples: { type: 'list', of: { type: 'sourceTime' }, optional: true },
  } },
  key: { parent: ['segment'], footage: 'win', at: 'at', duration: 'dur', influence: 'neighbors', fields: {
    win: { type: 'ref', to: ['window'] }, at: { type: 'time' }, dur: { type: 'duration' },
  } },
} })
const base: VideoEditSceneRecord[] = [
  { id: 'seg', kind: 'segment', values: { at: 290, end: 340 } },
  { id: 'win', kind: 'window', parent: 'seg', values: { media: 'A' } },
  { id: 'shot-a', kind: 'shot', parent: 'win', values: { at: 290, src: 0, media: 'A' } },
  { id: 'shot-b', kind: 'shot', parent: 'win', values: { at: 324.83, src: 0, media: 'B' } },
  { id: 'cut', kind: 'cut', values: { from: 306.18, to: 316.75 } },
]
const resolve = (records: VideoEditSceneRecord[]) => resolveVideoEditScene({ id: 'film', name: '片子', schema: { id: schema.id, version: 1 }, records }, schema)

describe('片子数据复核', () => {
  it('跨 306.18–316.75 剪切的区间：按窗口归属报连续数据错位，短时错位不过阈值', () => {
    const resolved = resolve([...base, { id: 'box', kind: 'box', parent: 'seg', values: { win: 'win', at: 300, end: 330 } }])
    const record = resolved.byId.get('box')!
    expect(record.container).toBe(resolved.byId.get('win'))
    const facts = reviewVideoEditScene(resolved, { to: 340, checks: ['scene_box_stale'] })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ kind: 'scene_box_stale', recordId: 'box', from: 314.71, to: 319.43 })
    expect(reviewVideoEditScene(resolved, { to: 314.3, checks: ['scene_box_stale'] })).toEqual([])
    expect(reviewVideoEditScene(resolved, { to: 340, checks: ['scene_cursor_jump'] })).toHaveLength(1)
  })

  it('sourceTime 范围按实际 src/rate 划分；neighbors 到下一落点并与父区间相交，不把 duration 当生效结束', () => {
    const records = base.filter(record => record.kind !== 'cut' && record.id !== 'shot-b')
    const resolved = resolve([...records,
      { id: 'box', kind: 'box', parent: 'seg', values: { win: 'win', at: 300, end: 310, samples: [10, 15] } },
      { id: 'k1', kind: 'key', parent: 'seg', values: { win: 'win', at: 298, dur: .1 } },
      { id: 'k2', kind: 'key', parent: 'seg', values: { win: 'win', at: 308, dur: .1 } },
      { id: 'shot-b', kind: 'shot', parent: 'win', values: { at: 305, src: 0, media: 'B' } },
    ])
    const facts = reviewVideoEditScene(resolved, { to: 350, checks: ['scene_box_stale'] })
    expect(facts.map(fact => [fact.recordId, fact.from, fact.to])).toEqual([['box', 305, 310], ['k1', 305.45, 308.1], ['k2', 305.45, 340]])
    const onlySource = resolve([...records, { id: 'box', kind: 'box', parent: 'seg', values: { win: 'win', at: 300, end: 310, samples: [10, 15] } }])
    expect(reviewVideoEditScene(onlySource, { to: 340, checks: ['scene_box_stale'] }).map(fact => [fact.from, fact.to])).toEqual([[305, 310]])
  })

  it('续放也查源时间跳变；连续源时间、隐藏鼠标及足够叠化不报，user 问题原样保留', () => {
    const resolved = resolve([...base,
      { id: 'shot-c', kind: 'shot', parent: 'win', values: { at: 326, src: 1.17, media: 'B' } },
      { id: 'shot-d', kind: 'shot', parent: 'win', values: { at: 327, src: 9, media: 'B', xf: .3 } },
      { id: 'shot-e', kind: 'shot', parent: 'win', values: { at: 328, src: 20, media: 'B', cursor: false } },
    ])
    const facts = reviewVideoEditScene(resolved, { to: 340, checks: ['scene_cursor_jump'] })
    expect(facts.map(fact => fact.recordId)).toEqual(['shot-a'])
    const issue = { recordId: 'win', path: 'timetable', message: '后半段不再取帧', severity: 'user' as const }
    const messages = reviewVideoEditScene({ ...resolved, issues: [issue, { path: 'parent', message: '仅整理' }] }, { to: 340, checks: ['scene_issue'] })
    expect(messages).toHaveLength(1)
    expect(messages[0].issue).toBe(issue)
  })

  it('叠化中旧画面仍在：从叠化结束报起，首个 neighbors 落点按父区间向前检查', () => {
    const resolved = resolve([
      ...base.filter(record => record.kind !== 'cut' && record.id !== 'shot-b'),
      { id: 'b', kind: 'shot', parent: 'win', values: { at: 295, src: 0, media: 'B', xf: .45 } },
      { id: 'first', kind: 'key', parent: 'seg', values: { win: 'win', at: 310, dur: .1 } },
    ])
    const facts = reviewVideoEditScene(resolved, { to: 340, checks: ['scene_box_stale'] })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ recordId: 'first', from: 295.45, to: 340 })
    expect(reviewVideoEditScene(resolved, { to: 340, range: { from: 295, to: 295.3 }, checks: ['scene_box_stale'] })).toEqual([])
  })

  it('只划分查询相交区间，远处内容不参与逐区间查找', () => {
    const resolved = resolve([
      ...base.filter(record => record.kind !== 'cut' && record.id !== 'shot-b'),
      ...Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, kind: 'shot', parent: 'win', values: { at: 290 + i / 10, src: i, media: i % 2 ? 'B' : 'A', xf: 0 } })),
      { id: 'box', kind: 'box', parent: 'seg', values: { win: 'win', at: 290, end: 340 } },
    ])
    let full = 0, bounded = 0
    reviewVideoEditScene(resolved, { to: 340, checks: ['scene_box_stale'], minSeconds: 0, work: () => { full++ } })
    const facts = reviewVideoEditScene(resolved, { to: 340, range: { from: 300, to: 301 }, checks: ['scene_box_stale'], minSeconds: 0, work: () => { bounded++ } })
    expect(facts.every(fact => fact.from >= 300 && fact.to <= 301)).toBe(true)
    expect(bounded).toBeLessThan(full / 2)
  })

  it('只有错位抵达记录真实生效结束才标为尾部，查询右边界不能充当结束', () => {
    const resolved = resolve([
      ...base.filter(record => record.kind !== 'cut' && record.id !== 'shot-b'),
      { id: 'b', kind: 'shot', parent: 'win', values: { at: 305, src: 0, media: 'B', xf: 0 } },
      { id: 'a2', kind: 'shot', parent: 'win', values: { at: 310, src: 0, media: 'A', xf: 0 } },
      { id: 'b2', kind: 'shot', parent: 'win', values: { at: 325, src: 0, media: 'B', xf: 0 } },
      { id: 'box', kind: 'box', parent: 'seg', values: { win: 'win', at: 300, end: 330 } },
    ])
    const options = { to: 340, checks: ['scene_box_stale'] as Array<'scene_box_stale'> }
    expect(reviewVideoEditScene(resolved, options).map(({ from, to, tail }) => [from, to, tail])).toEqual([[305, 310, false], [325, 330, true]])
    expect(reviewVideoEditScene(resolved, { ...options, range: { from: 300, to: 307 } })[0]).toMatchObject({ from: 305, to: 307, tail: false, openEnd: true })
    expect(reviewVideoEditScene(resolved, options)[0]).toMatchObject({ from: 305, to: 310, tail: false, openEnd: false })
    expect(reviewVideoEditScene(resolved, { ...options, range: { from: 327, to: 335 } })[0]).toMatchObject({ from: 327, to: 330, tail: true, openStart: true })
  })
})
