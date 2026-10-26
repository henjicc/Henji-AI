import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createVideoEditTestDocument } from './testFixtures'
import { makeVideoEditItemClip } from './projectItems'
import { videoEditComposition } from './document'
import { videoEditTextMediaIdentity } from './textTranscript'
import { createRecordingDocument } from '../screenRecording/document'
import { audioEditProjectSchema } from '../audioEdit/schema'
import { queryMediaContentIndex } from '../media/contentIndex'
import { audioDocumentContentFacts, recordingMediaContentFacts, videoEditSavedContentFacts } from './contentIndex'

function fixture() {
  const document = createVideoEditTestDocument('索引')
  const media = { id: 'media', name: '原片', kind: 'video' as const, path: path.resolve(path.sep, 'source.mp4'), durationSeconds: 10, width: 64, height: 64, hasAudio: true }
  document.media = [media]; document.items = [{ id: 'item', name: '原片', kind: 'video', mediaId: media.id }]
  const sequence = document.sequences[0]
  sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, duration: 60 }), id: 'clip', speed: { numerator: 2, denominator: 1 }, sourceInUs: 1000000 }]
  return { document, media, sequence }
}

describe('素材内容来源聚合', () => {
  it('同一来源跨序列去重，过期词源不返回，排除词形成检索边界', () => {
    const { document, media, sequence } = fixture()
    sequence.textTranscription = { audioDocumentId: 'voice', sources: [{ itemId: 'item', silences: [], mediaIdentity: videoEditTextMediaIdentity(videoEditComposition(document, sequence.id), 'item'), blocks: [
      { id: 'a', text: '打开', startFrame: 1000000, endFrame: 1500000, granularity: 'word', included: true, locked: false },
      { id: 'b', text: '不要', startFrame: 1500000, endFrame: 2000000, granularity: 'word', included: false, locked: false },
      { id: 'c', text: '后台', startFrame: 2000000, endFrame: 2500000, granularity: 'word', included: true, locked: false },
    ] }] }
    document.sequences.push({ ...structuredClone(sequence), id: 'other' })
    const facts = videoEditSavedContentFacts(document, ['item'], media)
    expect(facts).toHaveLength(2)
    expect(queryMediaContentIndex(facts, { text: '打开后台' })).toEqual([])
    document.media[0].path += '.replaced'
    expect(videoEditSavedContentFacts(document, ['item'], media)).toEqual([])
  })
  it('字幕按连续源时间投影变速和倒放，独立字幕不伪装成素材事实', () => {
    const { document, media, sequence } = fixture()
    sequence.captions = [{ id: 'bound', text: '校对文字', start: 45, duration: 15, clipId: 'clip' }, { id: 'standalone', text: '独立标题', start: 45, duration: 15 }]
    expect(videoEditSavedContentFacts(document, ['item'], media)).toMatchObject([{ kind: 'caption', text: '校对文字', basis: 'timeline', ranges: [{ fromUs: 2000000, toUs: 3000000 }] }])
    sequence.clips[0].reverse = true
    sequence.clips[0].sourceInUs = 5000000
    expect(videoEditSavedContentFacts(document, ['item'], media)[0].ranges).toEqual([{ fromUs: 3000000, toUs: 4000000 }])
  })
  it('口播采样帧换算源微秒，排除块不参与短语匹配', () => {
    const audio = audioEditProjectSchema.parse({ id: 'voice', name: '口播', source: { sourcePath: '/voice.wav', audioPath: '/voice.wav', mediaType: 'audio', sampleRate: 48000, channels: 1, durationFrames: 144000 }, revision: 1, createdAt: 1, updatedAt: 1, referenceScript: '', suggestions: [], transcript: [
      { id: 'a', text: '你好', startFrame: 48000, endFrame: 96000, granularity: 'word', included: true, locked: false },
      { id: 'b', text: '不要', startFrame: 96000, endFrame: 120000, granularity: 'word', included: false, locked: false },
      { id: 'c', text: '世界', startFrame: 120000, endFrame: 144000, granularity: 'segment', included: true, locked: false },
    ] })
    const facts = audioDocumentContentFacts(audio)
    expect(facts[0].ranges).toEqual([{ fromUs: 1000000, toUs: 2000000 }])
    expect(queryMediaContentIndex(facts, { text: '你好世界' })).toEqual([])
    expect(facts[1].precision).toBe('segment')
  })
  it('录制章节保留暂停造成的空档，同步音频不冒充屏幕文件的转录', () => {
    const recording = createRecordingDocument()
    recording.media = [{ id: 'screen', kind: 'screen', path: '/screen.mp4', monoUs: 1000000, durationUs: 10000000 }, { id: 'mic', kind: 'microphone', path: '/mic.wav', monoUs: 1000000, durationUs: 10000000 }]
    recording.understanding.steps = [
      { id: 'one', title: '打开', description: '后台', startUs: 2000000, endUs: 3000000, signal: 'click', eventIds: [] },
      { id: 'two', title: '完成', description: '', startUs: 6000000, endUs: 7000000, signal: 'click', eventIds: [] },
    ]
    recording.understanding.chapters = [{ id: 'chapter', title: '操作', stepIds: ['one', 'two'] }]
    recording.understanding.transcript = [{ id: 'word', mediaId: 'mic', text: '解说', startUs: 2000000, endUs: 3000000, granularity: 'word' }]
    const facts = recordingMediaContentFacts('recording', recording, ['screen'])
    expect(facts.find(fact => fact.kind === 'chapter')?.ranges).toEqual([{ fromUs: 1000000, toUs: 2000000 }, { fromUs: 5000000, toUs: 6000000 }])
    expect(facts.some(fact => fact.kind === 'transcript')).toBe(false)
    expect(recordingMediaContentFacts('recording', recording, ['mic']).find(fact => fact.kind === 'transcript')).toMatchObject({ text: '解说', ranges: [{ fromUs: 1000000, toUs: 2000000 }] })
  })
})
