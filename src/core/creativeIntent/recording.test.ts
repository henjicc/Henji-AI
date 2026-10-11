import { describe, expect, it } from 'vitest'
import { RecordingCollector } from '../../features/creativeIntent/recording/RecordingCollector'
import { recordingFixtureSession } from './fixtures/recordingFixtures'
import { sampleWallUs, alignRecordingTranscript } from './recordingAlignment'
import { serializeRecordingInput } from './recordingSerializer'
import { selectRecordingFrames } from './recordingEvidence'
import { transcriptEventSchema, type AudioClockSegment, type ExplanationEvent } from './schema'
import { normalizeTimestampedTranscript } from '../audioEdit/timestampedTranscript'

async function recorded() {
  const events: ExplanationEvent[] = []; const collector = new RecordingCollector(recordingFixtureSession(), async page => { if (page.kind !== 'clock' && page.kind !== 'samples') events.push(...page.entries) }, () => {})
  collector.start(0)
  const present = (us: number, frame: number, playing = false) => collector.presented(us, { timeline: { sequenceRef: { kind: 'video_edit.sequence', id: 'fixture-document:sequence' }, frame, fps: { numerator: 30, denominator: 1 } }, requestedFrame: 180, playing, direction: playing ? 1 : 0, rate: 1, scrubbing: false })
  present(10, 120); present(1_000_000, 120, true); present(2_000_000, 150, true); present(3_000_000, 180, true); present(3_000_010, 180); present(5_000_000, 150); present(6_000_000, 180)
  const audio = collector.record(6_500_000, { kind: 'audio', audioSegmentRef: 'block', startSample: 48_000, endSample: 336_000, monoSpanUs: [500_000, 6_500_000], sampleRate: 48_000, channels: 1, uncertaintyUs: 10_000 }) as AudioClockSegment
  collector.stop(7_000_000); await collector.flush(); return { collector, events: events.sort((a,b) => a.monoUs-b.monoUs || a.seq-b.seq), audio }
}
describe('E03/E06 分块ASR对齐及 JSONL', () => {
  it('JSONL保留示范属性、窗口几何/DPI/裁切和指向不确定度',async()=>{
    const events:ExplanationEvent[]=[];const collector=new RecordingCollector(recordingFixtureSession(),async page=>{if(page.kind!=='clock'&&page.kind!=='samples')events.push(...page.entries)},()=>{})
    collector.start(0);collector.record(1,{kind:'control',action:'property-mode',intent:'demonstrate',property:'rotationTurns'})
    const surfaceRef={kind:'application.surface',id:'workspace.video_edit'}
    collector.record(2,{kind:'geometry',snapshotRef:'geometry',surfaceRef,windowRef:'window',compositionSize:[1920,1080],validViewRect:[100,50,960,540],documentToView:[.5,0,0,.5,100,50],ancestorAffine:[1,0,0,1,20,10],pixelRatio:2,crop:[100,100,800,600],orientationTurns:.25,stateDigest:`sha256:${'1'.repeat(64)}`})
    collector.record(3,{kind:'pointer',surfaceRef,geometrySnapshotRef:'geometry',viewPoint:[200,100],documentPoint:null,compositionPoint:null,hoverRefs:[],pointedRefs:[],selectedRefs:[],intent:'navigate',phase:'move',uncertaintyUs:123})
    collector.stop(4);await collector.flush();const lines=[]
    for await(const line of serializeRecordingInput(collector.session,events.sort((a,b)=>a.monoUs-b.monoUs||a.seq-b.seq),{size:[1920,1080]}))lines.push(JSON.parse(line) as Record<string,unknown>)
    expect(lines.find(line=>line.type==='control'&&line.action==='property-mode')).toMatchObject({property:'rotationTurns',intent:'demonstrate'})
    expect(lines.find(line=>line.type==='geometry')).toMatchObject({window:'window',ancestorAffine:[1,0,0,1,20,10],pixelRatio:2,crop:[100,100,800,600],orientationTurns:.25})
    expect(lines.find(line=>line.type==='pointer')).toMatchObject({uncertaintyUs:123})
  })
  it('音频采样offset独立于到达时间；句级不分词，跨seek保留多跨度', async () => {
    const { collector, audio } = await recorded()
    expect(sampleWallUs(audio, 72_000)).toBe(1_000_000)
    const dto = normalizeTimestampedTranscript({ text: '先这里，再那里', segments: [{ text: '先这里，再那里', startMs: 3000, endMs: 5900 }] }, 6000, 'word')
    const result = alignRecordingTranscript(dto, audio, collector.session.clockSegments, collector.nextSeq, s => s)
    expect(result.entries).toHaveLength(1); expect(result.entries[0]).toMatchObject({ granularity: 'segment', alignmentQuality: 'coarse', monoSpanUs: [3_500_000, 6_400_000] })
    expect(result.entries[0].wordId).toBeUndefined(); expect(result.entries[0].timelineSpans.length).toBeGreaterThan(1); expect(() => transcriptEventSchema.parse(result.entries[0])).not.toThrow()
    const staticResult=alignRecordingTranscript(dto,{...audio,timeline:null,unavailableReason:'static'},[{id:'static-clock',mode:'hold',monoSpanUs:[0,7_000_000],start:null,end:null,anchors:[]}],100,s=>s)
    expect(staticResult.entries[0]).toMatchObject({timeline:null,unavailableReason:'static'})
  })
  it('无时间文字仍保留并标记不可用；负值/越界拒绝', async () => {
    const { collector, audio } = await recorded()
    const missing = alignRecordingTranscript(normalizeTimestampedTranscript({ text: '这边' }, 6000, 'word'), audio, collector.session.clockSegments, 100, s => s)
    expect(missing.entries[0]).toMatchObject({ text: '这边', alignmentQuality: 'unavailable', granularity: 'segment' })
    const invalid = { text: '越界', unit: 'ms' as const, words: [], granularity: 'segment' as const, segments: [{ text: '越界', startMs: -1, endMs: 7000, granularity: 'segment' as const, timing: 'coarse' as const }] }
    expect(() => alignRecordingTranscript(invalid, audio, collector.session.clockSegments, 100, s => s)).toThrow()
  })
  it('共享字典与双时间可还原；仅预览、无音频路径；相同帧不同visit不能去重', async () => {
    const { collector, events, audio } = await recorded(); const lines = []
    const word=alignRecordingTranscript(normalizeTimestampedTranscript({text:'这里',segments:[{text:'这里',startMs:100,endMs:200,words:[{text:'这里',startMs:100,endMs:200}]}]},6000,'word'),audio,collector.session.clockSegments,collector.nextSeq,s=>s)
    const merged=[...events,...word.entries].sort((a,b)=>a.monoUs-b.monoUs||a.seq-b.seq)
    for await (const line of serializeRecordingInput(collector.session, merged, { size: [1920,1080] })) lines.push(JSON.parse(line) as Record<string, unknown>)
    expect(lines.at(-1)).toMatchObject({ kind: 'request', execution: 'preview-only; recorded commands already happened' })
    expect(lines.filter(l => l.kind === 'event').length).toBe(merged.length)
    expect(lines.find(l=>l.type==='speech')).toMatchObject({granularity:'word',words:[[expect.any(String),600,700,'这里',expect.any(Array)]]})
    for (const line of lines.filter(l => l.kind === 'event')) { expect(line).toHaveProperty('w'); expect(line).toHaveProperty('t'); expect(line).toHaveProperty('cs') }
    expect(selectRecordingFrames(events, { atUs: 6_000_000, need: 'structured', stateDigest: () => 'state' })).toEqual([])
    const frames = selectRecordingFrames(events, { atUs: 5_000_000, need: 'change', stateDigest: event => String(event.timeline?.visitRef) })
    expect(frames.length).toBeGreaterThan(1); expect(new Set(frames.map(f => f.visit)).size).toBeGreaterThan(1)
    expect(selectRecordingFrames(events,{atUs:4_000_000,need:'appearance',stateDigest:()=> 'state'})[0].frame).toBe(180)
    expect(selectRecordingFrames(events,{atUs:0,need:'appearance',stateDigest:()=> 'state'})).toEqual([])
  })
})

it('静态 ASR 保留真实词级墙钟精度，粗句和录音缺口不会变精确', () => {
  const clock = { id: 'static', monoSpanUs: [0, 2_000_000] as [number, number], mode: 'hold' as const, start: null, end: null, anchors: [] }
  const audio: AudioClockSegment = { kind: 'audio', eventId: 'audio', seq: 0, monoUs: 0, timeline: null, unavailableReason: 'static', clockSegmentRef: 'static', audioSegmentRef: 'audio', startSample: 0, endSample: 96000, monoSpanUs: [0, 2_000_000], sampleRate: 48000, channels: 1, uncertaintyUs: 1000 }
  const dto = normalizeTimestampedTranscript({ text: '这个', segments: [{ text: '这个', startMs: 100, endMs: 400, words: [{ text: '这个', startMs: 100, endMs: 400 }] }] }, 2000, 'word')
  const precise = alignRecordingTranscript(dto, audio, [clock], 1, s => s).entries[0]
  expect(precise.alignmentQuality).toBe('precise'); expect(precise.timeline).toBeNull(); expect(precise.unavailableReason).toBe('static')
  expect(precise.monoSpanUs).toEqual([100000, 400000])
  const coarse = normalizeTimestampedTranscript({ text: '这个', segments: [{ text: '这个', startMs: 100, endMs: 400 }] }, 2000, 'word')
  expect(alignRecordingTranscript(coarse, audio, [clock], 1, s => s).entries[0].alignmentQuality).toBe('coarse')
  expect(alignRecordingTranscript(dto, audio, [{ ...clock, mode: 'gap' }], 1, s => s).entries[0].alignmentQuality).toBe('coarse')
})
