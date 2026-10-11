import { describe, expect, it, vi } from 'vitest'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import { explanationSessionSchema, type ExplanationEvent } from '@/core/creativeIntent/schema'
import { clockEventIssue } from '@/core/creativeIntent/contracts'
import type { CreativeIntentPage } from '@/core/creativeIntent/pages'
import { RecordingCollector, type RecordingPresentation } from './RecordingCollector'

const picture = (frame: number, playing = false, scrubbing = false): RecordingPresentation => ({ timeline: { sequenceRef: { kind: 'video_edit.sequence', id: 'fixture-document:sequence' }, frame, fps: { numerator: 30, denominator: 1 } }, requestedFrame: frame, playing, direction: playing ? 1 : 0, rate: 1, scrubbing })
describe('E01/E02/E03/E09 双时钟录制', () => {
  it('自主指针、播放暂停讲话、倒退与同帧重访不停止采集；录制暂停才出现 gap', async () => {
    const written: CreativeIntentPage[] = []; const collector = new RecordingCollector(recordingFixtureSession(), async page => { written.push(page) }, () => {})
    collector.start(0); collector.presented(10, picture(120))
    collector.presented(1_000_000, picture(120, true), 'play'); collector.presented(3_000_000, picture(180, true))
    collector.presented(3_000_001, picture(180), 'pause'); collector.presented(5_000_000, picture(180))
    collector.presented(5_100_000, picture(170, false, true), 'scrub'); collector.presented(6_000_000, picture(150, false, true), 'scrub')
    collector.presented(6_100_000, picture(150, true), 'play'); collector.presented(7_000_000, picture(180, true))
    expect(collector.session.state).toBe('recording'); expect(collector.session.clockSegments.some(c => c.mode === 'gap')).toBe(false)
    collector.pause(7_100_000); collector.resume(8_000_000); collector.presented(8_100_000, picture(180)); collector.stop(9_000_000); await collector.flush()
    expect(() => explanationSessionSchema.parse(collector.session)).not.toThrow()
    expect(collector.session.clockSegments.find(c => c.mode === 'gap')!.monoSpanUs[0]).toBeGreaterThan(7_100_000)
    const events = written.flatMap<ExplanationEvent>(p => p.kind !== 'clock' && p.kind !== 'samples' ? p.entries : []).sort((a, b) => a.seq - b.seq)
    for (const event of events) expect(clockEventIssue(event, collector.session.clockSegments)).toBeUndefined()
    expect(events.filter(e => e.kind === 'timeline').every(e => e.intent === 'navigate')).toBe(true)
    const visits = new Set(events.filter(e => e.timeline?.frame === 180).map(e => e.timeline!.visitRef)); expect(visits.size).toBeGreaterThan(1)
    expect(events.some(e => e.kind === 'delta')).toBe(false)
  })
  it('实际呈现120不能变成请求180；静态宿主保持 null', async () => {
    const written: CreativeIntentPage[] = []; const collector = new RecordingCollector(recordingFixtureSession(), async page => { written.push(page) }, () => {})
    collector.start(0); collector.presented(10, { ...picture(120), requestedFrame: 180 }); collector.stop(100); await collector.flush()
    expect(written.find(p => p.kind === 'timeline')).toMatchObject({ entries: [{ timeline: { frame: 120 }, requestedFrame: 180 }] })
    const staticCollector = new RecordingCollector(recordingFixtureSession('static'), async () => {}, () => {}); staticCollector.start(0)
    expect(staticCollector.record(20, { kind: 'control', action: 'property-mode' })).toMatchObject({ timeline: null, unavailableReason: 'static' })
    staticCollector.stop(100); await staticCollector.flush(); expect(() => explanationSessionSchema.parse(staticCollector.session)).not.toThrow()
  })
  it('I/O失败保留完整尾页，重试成功后不重采事件；恢复使用新的 visit 和 gap', async () => {
    const written: CreativeIntentPage[] = []; let failing = true; const pressure = vi.fn()
    const collector = new RecordingCollector(recordingFixtureSession(), async page => { if (failing) throw new Error('disk'); written.push(page) }, pressure)
    collector.start(0); for (let i = 1; i <= 800; i++) collector.record(i * 100, { kind: 'control', action: 'property-mode' })
    collector.pause(100_000); await expect(collector.flush()).rejects.toThrow('disk'); expect(pressure).toHaveBeenCalled()
    failing = false; await Promise.all([collector.flush(),collector.flush()]); expect(written.reduce((n, p) => n + p.count, 0)).toBe(802)
    const restored = new RecordingCollector(collector.session, async () => {}, () => {}); restored.resume(200_000); restored.presented(210_000, picture(0)); restored.stop(220_000); await restored.flush()
    expect(() => explanationSessionSchema.parse(restored.session)).not.toThrow()
  })
})
