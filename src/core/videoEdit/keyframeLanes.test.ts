import { describe, expect, it } from 'vitest'
import type { VideoEditClip } from './document'
import { deleteVideoEditLaneKeyframe, editVideoEditLaneChannel, moveVideoEditLaneKeyframe, shapeVideoEditLaneKeyframe, videoEditLaneTimes, videoEditTrackKeyframeLanes } from './keyframeLanes'

const clip = (id: string, start: number, extra: Partial<VideoEditClip> = {}): VideoEditClip => ({ id, kind: 'image', name: id, track: 1, start, duration: 60, ...extra }) as VideoEditClip
const blur = [{ key: 'radius', title: '模糊度', keys: ['radius'], discrete: false }]

describe('轨道关键帧行（重要记录 019）', () => {
  it('同一属性在各片段的关键帧并成一行，多维属性一行含全部分量；内置效果按种类与次序归并', () => {
    const a = clip('a', 0, { curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 10, value: 0.2, interpolation: 'linear' }] } })
    const b = clip('b', 100, {
      curves: { y: [{ time: 5, value: 0.1, interpolation: 'hold' }], opacity: [{ time: 0, value: 1, interpolation: 'ease' }] },
      effects: [{ id: 'e1', name: '高斯模糊', enabled: true, amount: 1, builtin: { id: 'blur', params: {}, curves: { radius: [{ time: 3, value: 4, interpolation: 'linear' }] } } }],
    })
    const lanes = videoEditTrackKeyframeLanes([b, a], id => id === 'blur' ? blur : [])
    expect(lanes.map(lane => lane.label)).toEqual(['位置', '不透明度', '高斯模糊 · 模糊度'])
    expect(lanes[0].entries.map(entry => entry.clip.id)).toEqual(['a', 'b'])
    expect(lanes[0].entries[0].channels.map(channel => [channel.key, channel.points.length])).toEqual([['x', 2], ['y', 0]])
    expect(videoEditLaneTimes(lanes[0])).toEqual([0, 10, 105])
    expect(lanes[2]).toMatchObject({ id: 'builtin:blur:0:radius', entries: [{ source: { kind: 'builtin', effectId: 'e1' } }] })
  })

  it('挪动整行关键帧：各分量一起挪，越界或落到已有关键帧上不动；去掉修剪残留', () => {
    const entry = videoEditTrackKeyframeLanes([clip('a', 0, { curves: { x: [{ time: 0, value: 0, interpolation: 'bezier', easeRange: [0, 0.5], easeValues: [0, 1] }, { time: 10, value: 1, interpolation: 'linear' }], y: [{ time: 0, value: 0.3, interpolation: 'linear' }] } })], () => [])[0].entries[0]
    expect(moveVideoEditLaneKeyframe(entry, 0, 10)).toBeNull()
    expect(moveVideoEditLaneKeyframe(entry, 0, 60)).toBeNull()
    const moved = moveVideoEditLaneKeyframe(entry, 0, 4)!
    expect(moved.x).toEqual([{ time: 4, value: 0, interpolation: 'bezier' }, { time: 10, value: 1, interpolation: 'linear' }])
    expect(moved.y).toEqual([{ time: 4, value: 0.3, interpolation: 'linear' }])
  })

  it('改形状、删关键帧：删光的分量留下被删那一帧的数值；单分量改值不动其他分量', () => {
    const entry = videoEditTrackKeyframeLanes([clip('a', 0, { curves: { x: [{ time: 0, value: 0, interpolation: 'bezier', bezier: [0.2, 0, 0.8, 1] }, { time: 10, value: 1, interpolation: 'linear' }], y: [{ time: 0, value: 0.3, interpolation: 'linear' }] } })], () => [])[0].entries[0]
    expect(shapeVideoEditLaneKeyframe(entry, 0, 'curve')).toEqual({ y: [{ time: 0, value: 0.3, interpolation: 'ease' }] })
    expect(shapeVideoEditLaneKeyframe(entry, 0, 'hold').x[0]).toEqual({ time: 0, value: 0, interpolation: 'hold' })
    expect(deleteVideoEditLaneKeyframe(entry, 0)).toEqual({ changes: { x: [{ time: 10, value: 1, interpolation: 'linear' }], y: [] }, statics: { y: 0.3 } })
    expect(editVideoEditLaneChannel(entry, 'x', 10, { value: 0.5 })).toEqual({ x: [entry.channels[0].points[0], { time: 10, value: 0.5, interpolation: 'linear' }] })
  })
})
