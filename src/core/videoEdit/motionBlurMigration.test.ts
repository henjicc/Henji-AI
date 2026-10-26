import { describe, expect, it } from 'vitest'
import { migrateEmbeddedVideoEditMotionBlurMaster, migrateVideoEditMotionBlurMaster } from './motionBlurMigration'

const moving = { id: 'moving', curves: { x: [{ time: 0, value: 0 }, { time: 10, value: 1 }] } }
const fading = { id: 'fading', curves: { opacity: [{ time: 0, value: 0 }] } }
const still = { id: 'still' }

describe('剪辑内容 30 → 31：运动模糊改为序列总开关', () => {
  it('关着的序列打开总开关，只有变换动画的片段单独关掉，画面与旧版一致', () => {
    const migrated = migrateVideoEditMotionBlurMaster({ sequences: [{ id: 'off', clips: [moving, fading, still] }, { id: 'false', motionBlur: false, clips: [moving] }] }) as { sequences: Array<{ motionBlur: boolean; clips: Array<Record<string, unknown>> }> }
    expect(migrated.sequences.map(sequence => sequence.motionBlur)).toEqual([true, true])
    expect(migrated.sequences[0].clips.map(clip => clip.motionBlur)).toEqual([false, undefined, undefined])
    expect(migrated.sequences[1].clips[0].motionBlur).toBe(false)
  })
  it('原来就开着的序列不变，不改输入', () => {
    const input = { sequences: [{ id: 'on', motionBlur: true, clips: [moving] }] }
    const migrated = migrateVideoEditMotionBlurMaster(input) as typeof input
    expect(migrated.sequences[0]).toBe(input.sequences[0])
    expect(input.sequences[0].clips[0]).toEqual(moving)
  })
  it('录屏文档里嵌着的剪辑快照按同一规则迁移', () => {
    const migrated = migrateEmbeddedVideoEditMotionBlurMaster({ movie: { project: { format: 'henji-video-project', sequences: [{ id: 'off', clips: [moving] }] } } }) as { movie: { project: { sequences: Array<{ motionBlur: boolean; clips: Array<Record<string, unknown>> }> } } }
    expect(migrated.movie.project.sequences[0].motionBlur).toBe(true)
    expect(migrated.movie.project.sequences[0].clips[0].motionBlur).toBe(false)
  })
})
