import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERSISTENCE_FORMATS } from '../persistence/formats'
import { upgradePersistenceContent } from '../persistence/migrations'
import { migrateEmbeddedVideoEditClipFades, migrateVideoEditClipFades, stripVideoEditClipFades } from './fadeTransitionMigration'
import { validateVideoEditTransitions } from './transitions'
import type { VideoEditDocument } from './document'

type Json = Record<string, unknown>
const sample = (): { sequences: Array<{ id: string; clips: Json[]; transitions?: Json[] }> } => JSON.parse(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v73.json', 'utf8')).content

describe('剪辑内容 73 → 74：淡入淡出并进单侧过渡', () => {
  it('画面片段成交叉溶解、声音片段成恒定功率；1 帧放长到 2 帧；已有过渡的一端保留原过渡；升级后通过当前格式与过渡校验', () => {
    const content = sample(), golden = content.sequences[0]
    const clip = (id: string): Json => golden.clips.find(value => value.id === id)!
    // golden-clip 两端已有单侧过渡；golden-cursor-clip 无过渡；声音片段与灯光各带淡化
    Object.assign(clip('golden-clip'), { fadeInFrames: 5, fadeOutFrames: 5 })
    Object.assign(clip('golden-cursor-clip'), { fadeInFrames: 1, fadeOutFrames: 30 })
    Object.assign(clip('golden-sound-clip'), { fadeInFrames: 12 })
    Object.assign(clip('golden-light'), { fadeOutFrames: 10 })
    const before = structuredClone(content)
    const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!
    const upgraded = upgradePersistenceContent(format, content, 73) as typeof content
    expect(content).toEqual(before)
    const sequence = upgraded.sequences[0]
    expect(sequence.clips.some(value => 'fadeInFrames' in value || 'fadeOutFrames' in value)).toBe(false)
    const added = sequence.transitions!.filter(value => String(value.id).includes('~fade-'))
    expect(added).toEqual([
      { id: 'golden-cursor-clip~fade-in', kind: 'cross_dissolve', rightClipId: 'golden-cursor-clip', durationFrames: 2 },
      { id: 'golden-cursor-clip~fade-out', kind: 'cross_dissolve', leftClipId: 'golden-cursor-clip', durationFrames: 30 },
      { id: 'golden-sound-clip~fade-in', kind: 'constant_power', rightClipId: 'golden-sound-clip', durationFrames: 12 },
    ])
    const document = { ...upgraded, format: 'henji-video-project', version: 10, id: 'golden', name: '黄金', revision: 0 } as unknown as VideoEditDocument
    expect(() => validateVideoEditTransitions(document)).not.toThrow()
  })
  it('两端淡化合计不超过片段，也让开另一端普通过渡占的部分', () => {
    const migrated = migrateVideoEditClipFades({ sequences: [{ id: 's', clips: [
      { id: 'a', kind: 'video', duration: 30, fadeInFrames: 25, fadeOutFrames: 25 },
      { id: 'b', kind: 'video', duration: 30, fadeInFrames: 25 },
      { id: 'c', kind: 'video', duration: 30, fadeInFrames: 5 },
    ], transitions: [{ id: 'mix', kind: 'cross_dissolve', leftClipId: 'a', rightClipId: 'b', durationFrames: 10 }] }] }) as { sequences: Array<{ transitions: Json[] }> }
    expect(migrated.sequences[0].transitions.map(value => [value.id, value.durationFrames])).toEqual([['mix', 10], ['a~fade-in', 25], ['c~fade-in', 5]])
  })
  it('调整图层与灯光的淡化写成同样走向的不透明度关键帧；片段版本快照里的淡化字段去掉', () => {
    const migrated = migrateVideoEditClipFades({ sequences: [{ id: 's', clips: [
      { id: 'adjust', kind: 'adjustment', duration: 30, opacity: .8, fadeInFrames: 10, fadeOutFrames: 5 },
      { id: 'shot', kind: 'video', duration: 30, takes: [{ itemId: 'old', linkedAudio: [{ clip: { id: 'voice', kind: 'audio', fadeInFrames: 3 } }] }] },
    ] }] }) as { sequences: Array<{ clips: Json[]; transitions?: Json[] }> }
    const [adjust, shot] = migrated.sequences[0].clips
    expect(adjust).not.toHaveProperty('fadeInFrames')
    expect((adjust.curves as { opacity: unknown }).opacity).toEqual([{ time: 0, value: 0, interpolation: 'linear' }, { time: 10, value: .8, interpolation: 'linear' }, { time: 24, value: .8, interpolation: 'linear' }, { time: 29, value: 0, interpolation: 'linear' }])
    expect(JSON.stringify(shot.takes)).not.toContain('fadeInFrames')
    expect(migrated.sequences[0].transitions).toBeUndefined()
  })
  it('录屏嵌着的剪辑快照同样迁移，字幕回填记录的声音快照只去掉淡化字段', () => {
    const embedded = migrateEmbeddedVideoEditClipFades({ movie: { project: { format: 'henji-video-project', sequences: [{ id: 's', clips: [{ id: 'n', kind: 'audio', duration: 60, fadeInFrames: 1, fadeOutFrames: 1 }] }] } } }) as { movie: { project: { sequences: Array<{ clips: Json[]; transitions: Json[] }> } } }
    expect(embedded.movie.project.sequences[0].clips[0]).not.toHaveProperty('fadeInFrames')
    expect(embedded.movie.project.sequences[0].transitions.map(value => value.durationFrames)).toEqual([2, 2])
    expect(stripVideoEditClipFades({ soundClips: [{ id: 'n', fadeInFrames: 3, volume: 1 }] })).toEqual({ soundClips: [{ id: 'n', volume: 1 }] })
  })
})
