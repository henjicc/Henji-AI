import { describe, expect, it } from 'vitest'
import type { CodeVideoSpan } from '../../imaging/parameterTypes'
import { parseCodeSceneSchema, validateCodeSceneRecords } from './sceneDeclaration'
import { videoEditSceneInputs } from './sceneInputs'
import { resolveVideoEditScene, videoEditSceneCutTime, videoEditSceneWriteBackSpan, videoEditSceneWriteBackTime, type ResolvedVideoEditScene } from './sceneResolve'
import type { VideoEditScene, VideoEditSceneRecord } from './sceneSchema'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from './sceneTestFixtures'

/**
 * 对照《元宝搜索》代码片子现有的编排（style/dot-matrix/scene/compose.ts、shots.ts）：把 03–05、14–16 段按全片原时间
 * 写成片子数据记录，期望值是用 esbuild 打包片子代码、对全片描述跑 shotsOf / winInputs / 锚定 / 剪切后取出的结果，原样抄在这里。
 */
const FILM = parseCodeSceneSchema({
  id: 'dot-matrix.film', version: 1,
  kinds: {
    segment: { role: 'segment', at: 'start', end: 'end', influence: 'span', lane: { style: 'bar', label: 'name' }, fields: { name: { type: 'text', maxLength: 80 }, start: { type: 'time' }, end: { type: 'time' } } },
    window: { at: 'at', end: 'until', influence: 'span', fields: { at: { type: 'time' }, until: { type: 'time' } } },
    shot: {
      role: 'shot', parent: ['window'], at: 'at', influence: 'untilNext', footage: 'media', lane: { style: 'block' },
      fields: { at: { type: 'time' }, media: { type: 'media', accept: ['video', 'image'] }, src: { type: 'sourceTime' }, rate: { type: 'number', min: 0, max: 16, default: 1 }, xf: { type: 'duration', max: 5, optional: true }, cursor: { type: 'boolean', default: true } },
    },
    camera: { at: 'at', influence: 'neighbors', lane: { style: 'key' }, fields: { at: { type: 'time' }, dur: { type: 'duration', max: 10 } } },
    focus: { parent: ['segment'], fields: { end: { type: 'time' } } },
    focusKey: { parent: ['focus'], at: 'at', influence: 'neighbors', footage: 'media', lane: { style: 'key' }, fields: { at: { type: 'time', anchor: 'footage' }, dur: { type: 'duration', max: 10, optional: true }, win: { type: 'ref', to: ['window'] }, media: { type: 'media', accept: ['video'] } } },
    card: { parent: ['segment'], at: 'at', end: 'out', influence: 'span', fields: { at: { type: 'time' }, out: { type: 'time' } } },
    label: { at: 'at', end: 'out', influence: 'span', fields: { at: { type: 'time' }, out: { type: 'time' } } },
    cut: { role: 'cut', at: 'from', end: 'to', influence: 'span', lane: { style: 'cut' }, fields: { from: { type: 'time' }, to: { type: 'time' }, enabled: { type: 'boolean', default: true } } },
  },
})
type Shot = [at: number, media: string, src: number, extra?: Record<string, number | boolean>]
const segment = (id: string, start: number, end: number): VideoEditSceneRecord => ({ id, kind: 'segment', values: { name: id, start, end } })
const window = (id: string, at: number, until: number, shots: Shot[]): VideoEditSceneRecord[] => [
  { id, kind: 'window', values: { at, until } },
  ...shots.map(([at, media, src, extra]) => ({ id: `${id}@${at}`, kind: 'shot', parent: id, values: { at, media, src, ...extra } })),
]
const key = (id: string, focus: string, at: number | { src: number }, win: string, media: string): VideoEditSceneRecord => ({ id, kind: 'focusKey', parent: focus, values: { at, win, media } })
const scene = (records: VideoEditSceneRecord[]): VideoEditScene => ({ id: 'film', name: '元宝搜索', schema: { id: 'dot-matrix.film', version: 1 }, records })
const lanes = (resolved: ResolvedVideoEditScene) => Object.values(videoEditSceneInputs(resolved)).map(input => input.kind === 'video' ? { media: input.mediaId, spans: input.spans } : { media: input.mediaId })
const media = new Map(['sw-main', 'cite', 'src', 'how-pref', 'out', 'rec', 'other'].map(id => [id, 'video' as const]))

describe('片子数据解析', () => {
  it('03–05 效果展示工位：取帧时间表、默认叠化、车道与按录屏秒锚定的时刻和代码片子的编排逐项相等', () => {
    const data = scene([
      segment('switch', 57.58, 95.05), segment('citations', 95.05, 107.65), segment('sources', 107.65, 126.58),
      ...window('demo', 58.65, 173.77, [
        [58.65, 'sw-main', 0.9], [59.58, 'sw-main', 1.83, { cursor: false }], [63.33, 'sw-main', 5.58], [68.13, 'sw-main', 10.38, { cursor: false }],
        [69.68, 'sw-main', 11.9, { rate: 0 }], [70.08, 'sw-main', 12.4, { xf: 0.35 }], [70.58, 'sw-main', 12.9, { rate: 0 }], [70.98, 'sw-main', 14.2, { xf: 0.4 }],
        [72.98, 'sw-main', 16.15, { rate: 0 }], [73.58, 'sw-main', 17.3, { xf: 0.4 }], [73.93, 'sw-main', 17.62, { rate: 0 }], [74.48, 'sw-main', 18.45, { xf: 0.4 }],
        [80.18, 'sw-main', 24.15, { rate: 0 }], [84.18, 'sw-main', 27.3, { rate: 0, xf: 0.4 }], [87.58, 'sw-main', 34.7, { rate: 0, xf: 0.5 }],
        [95.05, 'cite', 0.3], [99.05, 'cite', 4.3, { cursor: false }], [101.35, 'cite', 6.6, { rate: 0 }], [103.15, 'cite', 9.2, { xf: 0.45, cursor: false }], [105.7, 'cite', 11.75, { rate: 0 }],
        [107.65, 'src', 0], [113.05, 'src', 5.4, { rate: 0 }],
      ]),
      { id: 'f03', kind: 'focus', parent: 'switch', values: { end: 86.98 } },
      key('k03-ask', 'f03', 63.95, 'demo', 'sw-main'), key('k03-slot', 'f03', { src: 14.3 }, 'demo', 'sw-main'), key('k03-n12', 'f03', { src: 15.1 }, 'demo', 'sw-main'),
      // 13.5 秒被跳过（12.9 停住后直接叠化到 14.2）；12.6 在快放的一项里；16.15 第一次放到是在 14.2 那一项里，不是后面停住的那一项
      key('k03-skipped', 'f03', { src: 13.5 }, 'demo', 'sw-main'), key('k03-play', 'f03', { src: 12.6 }, 'demo', 'sw-main'), key('k03-first', 'f03', { src: 16.15 }, 'demo', 'sw-main'),
      { id: 'f04', kind: 'focus', parent: 'citations', values: { end: 107.35 } },
      key('k04-detail', 'f04', 103.8, 'demo', 'cite'), key('k04-sources', 'f04', { src: 10.6 }, 'demo', 'cite'),
      // 只在所在段落里找：数字角标那段的窗口里没有放交换机录屏
      key('k04-elsewhere', 'f04', { src: 0.9 }, 'demo', 'sw-main'),
    ])
    expect(validateCodeSceneRecords(FILM, data, { media })).toEqual([])
    const resolved = resolveVideoEditScene(data, FILM, { media })

    const [main0, main1, cite0, cite1, src0] = lanes(resolved) as Array<{ media: string; spans: CodeVideoSpan[] }>
    expect(main0).toEqual({ media: 'sw-main', spans: [{ from: 58.65, to: 59.58, src: 0.9 }, { from: 59.58, to: 63.33, src: 1.83, cursor: false }, { from: 63.33, to: 68.13, src: 5.58 }, { from: 68.13, to: 69.68, src: 10.38, cursor: false }, { from: 69.68, to: 70.43, src: 11.9, rate: 0 }, { from: 70.98, to: 72.98, src: 14.2 }, { from: 72.98, to: 73.98, src: 16.15, rate: 0 }, { from: 74.48, to: 80.18, src: 18.45 }, { from: 80.18, to: 84.58, src: 24.15, rate: 0 }, { from: 87.58, to: 95.5, src: 34.7, rate: 0 }] })
    expect(main1).toEqual({ media: 'sw-main', spans: [{ from: 70.08, to: 70.58, src: 12.4 }, { from: 70.58, to: 71.38, src: 12.9, rate: 0 }, { from: 73.58, to: 73.93, src: 17.3 }, { from: 73.93, to: 74.88, src: 17.62, rate: 0 }, { from: 84.18, to: 88.08, src: 27.3, rate: 0 }] })
    expect(cite0).toEqual({ media: 'cite', spans: [{ from: 95.05, to: 99.05, src: 0.3 }, { from: 99.05, to: 101.35, src: 4.3, cursor: false }, { from: 101.35, to: 103.6, src: 6.6, rate: 0 }] })
    expect(cite1).toEqual({ media: 'cite', spans: [{ from: 103.15, to: 105.7, src: 9.2, cursor: false }, { from: 105.7, to: 108.1, src: 11.75, rate: 0 }] })
    expect(src0.spans[0]).toEqual({ from: 107.65, to: 113.05, src: 0 })
    const shots = resolved.byId.get('demo')!.timetables[0].shots
    expect(shots.map(shot => [shot.xf, shot.lane])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0.35, 1], [0, 1], [0.4, 0], [0, 0], [0.4, 1], [0, 1], [0.4, 0], [0, 0], [0.4, 1], [0.5, 0], [0.45, 0], [0, 0], [0, 0], [0.45, 1], [0, 1], [0.45, 0], [0, 0]])
    // 每项内容指向自己的记录，键就是 inputs.images 里的键
    expect(shots[5].record.id).toBe('demo@70.08')
    expect(Object.keys(videoEditSceneInputs(resolved))).toContain(shots[5].input)

    const at = (id: string) => resolved.byId.get(id)!.at!
    for (const [id, expected] of [['k03-ask', 63.95], ['k03-slot', 71.08], ['k03-n12', 71.88], ['k03-skipped', 70.98], ['k03-play', 70.28], ['k03-first', 72.93], ['k04-detail', 103.8], ['k04-sources', 104.55]] as const) expect(at(id)).toBeCloseTo(expected, 9)
    expect(resolved.byId.has('k04-elsewhere')).toBe(false)
    expect(resolved.issues).toEqual([expect.objectContaining({ recordId: 'k04-elsewhere', path: 'values.at' })])
    // 记录之间的关系保留成对象引用，同类记录按时刻排好
    expect(resolved.byId.get('k03-slot')!.parent!.parent!.id).toBe('switch')
    expect(resolved.byId.get('f03')!.children.map(child => child.id)).toEqual(['k03-ask', 'k03-play', 'k03-skipped', 'k03-slot', 'k03-n12', 'k03-first'])
  })

  it('14–16 段跨过剪掉的 15 段：整段丢掉、之后前移、剪切口前起步的落点丢掉、跨进剪切的退场不动，与代码片子的 applyCuts 结果一致', () => {
    const data = scene([
      segment('how', 271.12, 306.22), segment('images', 306.22, 316.88), segment('output', 316.88, 339.4),
      ...window('side', 291.02, 306.72, [[291.02, 'src', 0], [296.42, 'src', 5.4, { rate: 0 }], [298.27, 'how-pref', 0], [302.62, 'how-pref', 4.37, { rate: 0 }]]),
      ...window('ans', 324.83, 339.88, [[324.83, 'out', 0.5, { rate: 0 }], [333.28, 'out', 2.45, { rate: 0, xf: 0.45 }]]),
      { id: 'card-text', kind: 'card', parent: 'images', values: { at: 307.27, out: 316.62 } },
      // 没挂在段落下：整段落在剪切里的跟着丢，伸出剪切的留下来并报出来
      { id: 'label-inside', kind: 'label', values: { at: 308, out: 316 } },
      { id: 'label-stray', kind: 'label', values: { at: 307.27, out: 320 } },
      ...[[302.6, 1.8], [306.0, 2.0], [316.7, 2.0], [324.8, 1.8], [326.1, 1.2], [333.4, 1.2], [338.4, 1.6], [339.2, 2.2]].map(([at, dur]) => ({ id: `cam@${at}`, kind: 'camera', values: { at, dur } })),
      { id: 'f16', kind: 'focus', parent: 'output', values: { end: 333.33 } },
      ...[326.08, 327.88, 329.33, 331.73].map(at => key(`k16@${at}`, 'f16', at, 'ans', 'out')),
      { id: 'cut-images', kind: 'cut', values: { from: 306.1833, to: 316.7533 } },
    ])
    expect(validateCodeSceneRecords(FILM, data, { media })).toEqual([])
    const resolved = resolveVideoEditScene(data, FILM, { media })

    expect(lanes(resolved)).toEqual([
      { media: 'src', spans: [{ from: 291.02, to: 296.42, src: 0 }, { from: 296.42, to: 298.72, src: 5.4, rate: 0 }] },
      { media: 'how-pref', spans: [{ from: 298.27, to: 302.62, src: 0 }, { from: 302.62, to: 306.72, src: 4.37, rate: 0 }] },
      { media: 'out', spans: [{ from: 314.26, to: 323.16, src: 0.5, rate: 0 }] },
      { media: 'out', spans: [{ from: 322.71, to: 329.31, src: 2.45, rate: 0 }] },
    ])
    const extent = (id: string) => { const record = resolved.byId.get(id)!; return [record.at, record.end] }
    const close = (actual: Array<number | undefined>, expected: number[]) => expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9))
    close(extent('how'), [271.12, 306.22]); close(extent('side'), [291.02, 306.72])
    close(extent('output'), [306.31, 328.83]); close(extent('ans'), [314.26, 329.31])
    expect(['images', 'card-text', 'label-inside', 'cam@306'].map(id => resolved.byId.has(id))).toEqual([false, false, false, false])
    expect(resolved.issues).toEqual([expect.objectContaining({ recordId: 'label-stray', path: 'parent' })])
    close(resolved.byKind.camera.map(record => record.at!), [302.6, 306.13, 314.23, 315.53, 322.83, 327.83, 328.63])
    close(resolved.byKind.focusKey.map(record => record.at!), [315.51, 317.31, 318.76, 321.16])
    expect(resolved.byId.get('f16')!.values.end).toBeCloseTo(322.76, 9)
    // 剪切本身收成剪切口一点
    close(extent('cut-images'), [306.1833, 306.1833])
    // 拖动写回时间点（镜头落点）：落到会被丢掉的剪切口一带时取剪切后面的来源；不会丢的时刻按原值那一侧换回
    const points: Array<[t: number, original: number | undefined, expected: number]> = [
      [305.9, 302.6, 316.47], [310, 302.6, 320.57], [300, 324.8, 300], [315.26, 324.83, 325.83], [305.9, undefined, 316.47],
    ]
    for (const [t, original, expected] of points) {
      const raw = videoEditSceneWriteBackTime(resolved.cuts, t, { original, point: true })
      expect(raw).toBeCloseTo(expected, 9)
      expect(videoEditSceneCutTime(resolved.cuts, raw)).toBeCloseTo(t, 9)
    }
    // 不是时间点位置的时刻字段（高亮的结束）不会因此丢掉，取剪切前那一侧
    expect(videoEditSceneWriteBackTime(resolved.cuts, 305.9)).toBeCloseTo(305.9, 9)
    // 整条写回有起止的记录：段落结尾、窗口退场在剪切口一带原地微调，不会挪到剪切后面盖住剪掉的段；
    // 卡片 302–306.1 把开头拖到 305.8，起点跟着结尾留在剪切前，不会写成晚于结尾的 316.37；整条拖进剪切里会被丢掉时换到剪切后面
    const spans: Array<[start: number, end: number, original: { start: number; end: number }, expected: [number, number]]> = [
      [271.12, 306.22, { start: 271.12, end: 306.22 }, [271.12, 306.22]], [271.12, 306.5, { start: 271.12, end: 306.22 }, [271.12, 306.5]],
      [291.02, 305, { start: 291.02, end: 306.72 }, [291.02, 305]], [305.8, 306.1, { start: 302, end: 306.1 }, [305.8, 306.1]],
      [306.0, 314.26, { start: 316.88, end: 324.83 }, [316.57, 324.83]], [306.5, 309, { start: 302, end: 306.1 }, [317.07, 319.57]],
    ]
    for (const [start, end, original, expected] of spans) {
      const raw = videoEditSceneWriteBackSpan(resolved.cuts, start, end, original)
      close([raw.start, raw.end], expected)
      expect(raw.start).toBeLessThanOrEqual(raw.end)
      close([videoEditSceneCutTime(resolved.cuts, raw.start), videoEditSceneCutTime(resolved.cuts, raw.end)], [start, end])
    }
    // 停用剪切就全部恢复
    const restored = resolveVideoEditScene(scene(data.records.map(record => record.kind === 'cut' ? { ...record, values: { ...record.values, enabled: false } } : record)), FILM, { media })
    expect(restored.cuts).toEqual([])
    expect(restored.byId.get('ans')!.at).toBe(324.83)
    expect(restored.byKind.camera).toHaveLength(8)
  })

  it('一条取帧车道超过取帧时间表的段数上限时截到上限，并在解析结果里报出', () => {
    const resolved = resolveVideoEditScene(scene(window('long', 0, 600, Array.from({ length: 520 }, (_, index): Shot => [index, 'rec', index * 2]))), FILM, { media })
    expect(Object.values(resolved.timetables[0].inputs).map(input => input.kind === 'video' && input.spans!.length)).toEqual([512])
    expect(resolved.issues).toEqual([expect.objectContaining({ recordId: 'long', path: 'timetable', severity: 'user' })])
  })

  it('剪切按波纹删除换算窗口内容：横跨剪切的一项在剪切口接着放剪切结尾的源时间，开头落在剪切里的从剪切结尾放起', () => {
    const data = scene([
      ...window('w', 0, 30, [[0, 'rec', 0], [10, 'rec', 100], [20, 'other', 200, { rate: 0 }]]),
      { id: 'cut-a', kind: 'cut', values: { from: 4, to: 6 } },
      { id: 'cut-b', kind: 'cut', values: { from: 9, to: 12 } },
    ])
    const resolved = resolveVideoEditScene(data, FILM, { media })
    expect(resolved.byId.get('w')!.timetables[0].shots.map(shot => [shot.record.id, shot.at, shot.src, shot.xf, shot.lane, shot.end])).toEqual([
      ['w@0', 0, 0, 0, 0, 4], ['w@0', 4, 6, 0, 0, 7], ['w@10', 7, 102, 0, 0, 15], ['w@20', 15, 200, 0.45, 0, 25],
    ])
    expect(lanes(resolved)).toEqual([
      { media: 'rec', spans: [{ from: 0, to: 4, src: 0 }, { from: 4, to: 7, src: 6 }, { from: 7, to: 15.45, src: 102 }] },
      { media: 'other', spans: [{ from: 15, to: 25, src: 200, rate: 0 }] },
    ])
    expect([resolved.byId.get('w@0')!.at, resolved.byId.get('w@0')!.end]).toEqual([0, 7])
  })

  it('黄金片子数据：{src} 沿 footage 引用找到窗口与素材；短于 0.5 秒的剪切只前移剪切口之后的时刻；同一 scene 对象重复解析直接命中缓存', () => {
    const schema = parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION)
    const data = goldenScene('screen')
    const resolved = resolveVideoEditScene(data, schema)
    expect(resolved.issues).toEqual([])
    expect(resolved.byId.get('fk-1')!.at).toBeCloseTo(0.8, 9)
    expect(resolved.byId.get('fk-1')!.footage).toBe('screen')
    expect([resolved.byId.get('seg-switch')!.at, resolved.byId.get('seg-switch')!.end]).toEqual([0.5, 2.5])
    expect([resolved.byId.get('cut-1')!.at, resolved.byId.get('cut-1')!.end]).toEqual([2.6, 2.6])
    // 没有时刻、也没有缺省字段的记录直接沿用文档里的取值对象
    expect(resolved.byId.get('win-demo')!.values).toBe(data.records[1].values)
    expect(resolveVideoEditScene(data, schema)).toBe(resolved)
    expect(videoEditSceneInputs(resolveVideoEditScene(data, schema))).toBe(videoEditSceneInputs(resolved))
    expect(resolveVideoEditScene(data, schema, { duration: 5 })).not.toBe(resolved)
    expect(resolveVideoEditScene({ ...data }, schema)).not.toBe(resolved)
    // 没写 role 的记录类型没有任何特殊语义：同样外形的剪切不剪，窗口内容不成时间表，段落不圈定锚定范围
    const plain = parseCodeSceneSchema({ ...GOLDEN_SCENE_DECLARATION, kinds: Object.fromEntries(Object.entries(GOLDEN_SCENE_DECLARATION.kinds as Record<string, Record<string, unknown>>).map(([name, { role: _role, ...kind }]) => [name, kind])) })
    const unmarked = resolveVideoEditScene(data, plain)
    expect([unmarked.cuts, unmarked.timetables]).toEqual([[], []])
    expect(unmarked.byId.has('fk-1')).toBe(false)
  })
})
