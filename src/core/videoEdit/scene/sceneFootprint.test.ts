import { describe, expect, it } from 'vitest'
import { parseCodeSceneSchema } from './sceneDeclaration'
import { videoEditSceneFootprints, videoEditSceneRecordsInRange } from './sceneFootprint'
import { resolveVideoEditScene } from './sceneResolve'
import type { VideoEditSceneRecord } from './sceneSchema'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from './sceneTestFixtures'

describe('片子数据记录的影响时段', () => {
  it('按 influence 与 margin 算出剪后时段：span、untilNext（含下一项叠化）、neighbors（前后两条之间，首末到所在段落为止）、剪切到片尾，说不清的计入每一段', () => {
    // 高亮挂在段落下：高亮本身没有时刻，首末落点的时段止于段落的起止，改它们不让全片失效
    const schema = parseCodeSceneSchema({ ...GOLDEN_SCENE_DECLARATION, kinds: { ...GOLDEN_SCENE_DECLARATION.kinds, focus: { ...GOLDEN_SCENE_DECLARATION.kinds.focus, parent: ['segment'] } } })
    const golden = goldenScene('screen')
    const target = { x: 0, y: 0, width: 0.5, height: 0.5 }
    const records: VideoEditSceneRecord[] = [
      ...golden.records.map(record => record.id === 'seg-switch' ? { ...record, values: { ...record.values, start: 0 } } : record.id === 'fo-1' ? { ...record, parent: 'seg-switch' } : record),
      { id: 'sh-3', kind: 'shot', parent: 'win-demo', values: { at: 3, media: 'other', src: 0 } },
      { id: 'fk-2', kind: 'focusKey', parent: 'fo-1', values: { at: 1.2, dur: 0.4, win: 'win-demo', target } },
      { id: 'fk-3', kind: 'focusKey', parent: 'fo-1', values: { at: 2, dur: 0.5, win: 'win-demo', target } },
    ]
    const footprints = videoEditSceneFootprints(resolveVideoEditScene({ ...golden, records }, schema, { duration: 10 }))
    expect(footprints.global.map(record => record.id)).toEqual(['win-demo', 'fo-1'])
    const spans = Object.fromEntries(footprints.timed.map(item => [item.record.id, [item.from, item.to]]))
    expect(spans['seg-switch']).toEqual([0, 2.5])
    // 窗口内容：sh-2 放到 sh-3 开始（剪切后 2.8），sh-3 换了素材、默认叠化 0.45 秒，这段时间 sh-2 仍在画面上
    expect(spans['sh-1']).toEqual([0, 1.5])
    expect(spans['sh-2'][0]).toBe(1.5)
    expect(spans['sh-2'][1]).toBeCloseTo(3.25, 9)
    expect(spans['sh-3'][0]).toBeCloseTo(2.8, 9)
    expect(spans['sh-3'][1]).toBe(10)
    // 落点：上一条的 at 到下一条的结束，再往前留 0.3 秒；第一条从段落开头、最后一条到段落结尾
    expect(spans['fk-1'][0]).toBeCloseTo(-0.3, 9)
    expect(spans['fk-1'][1]).toBeCloseTo(1.6, 9)
    expect(spans['fk-2'][0]).toBeCloseTo(0.5, 9)
    expect(spans['fk-2'][1]).toBe(2.5)
    expect(spans['fk-3'][0]).toBeCloseTo(0.9, 9)
    expect(spans['fk-3'][1]).toBe(2.5)
    expect(spans['cut-1']).toEqual([2.1, Infinity])

    const ids = (from: number, to: number) => videoEditSceneRecordsInRange(footprints, from, to).map(record => record.id)
    expect(ids(0, 0.5)).toEqual(['win-demo', 'fo-1', 'fk-1', 'seg-switch', 'sh-1'])
    expect(ids(4, 6)).toEqual(['win-demo', 'fo-1', 'cut-1', 'sh-3'])
  })
})
