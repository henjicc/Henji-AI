import { describe, it, expect } from 'vitest'
import { createVideoEditDocument, videoEditDocumentSchema, changeVideoEditSequenceSettings, videoEditDuration } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEdit, copyVideoEditClips } from './timelineEdits'
import { assertVideoEditLockedTracks } from './lockedTracks'
import { importVideoEditCaptions, exportVideoEditCaptions, videoEditCaptionClips, reconcileVideoEditTimedContent } from './timedContent'
import { parseSubtitleText } from '../media/subtitleFormat'

function fixture() {
  const document = createVideoEditDocument('字幕测试'); const sequence = document.sequences[0]
  document.items = [{ id: 'item', name: '文字', kind: 'text' }]
  sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, track: 1 }), id: 'clip', duration: 90 }]
  sequence.markers = [{ id: 'marker', clipId: 'clip', frame: 70, name: '词边界' }, { id: 'program-marker', frame: 5, name: '序列' }]
  sequence.captions = [{ id: 'caption', clipId: 'clip', start: 50, duration: 50, text: '跟随片段' }, { id: 'program-caption', start: 5, duration: 20, text: '节目时钟' }]
  return { document, sequence }
}

describe('字幕与标记的半开锚定', () => {
  it('旧v2可读；真实移动跟随clip，序列对象保持原时钟', () => {
    expect(videoEditDocumentSchema.parse(createVideoEditDocument('旧剪辑')).sequences[0].captions).toBeUndefined()
    const { document, sequence } = fixture()
    const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['clip'], mode: 'move', delta: 100 })
    expect(next.captions).toMatchObject([{ start: 150, duration: 50 }, { start: 5 }])
    expect(next.markers).toMatchObject([{ frame: 170 }, { frame: 5 }])
    expect(videoEditDocumentSchema.parse({ ...document, sequences: [next] })).toBeTruthy()
  })
  it('拆分切分跨界字幕、边界标记只归右侧、引用和ID保持有效', () => {
    const { document, sequence } = fixture()
    const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'split', clipIds: ['clip'], frame: 70 })
    const right = next.clips.find(clip => clip.start === 70)!
    const captions = next.captions!.filter(caption => caption.clipId)
    expect(captions).toMatchObject([{ id: 'caption', clipId: 'clip', start: 50, duration: 20 }, { clipId: right.id, start: 70, duration: 30 }])
    expect(captions[1].id).not.toBe('caption')
    expect(next.markers![0]).toMatchObject({ frame: 70, clipId: right.id })
    expect(videoEditDocumentSchema.safeParse({ ...document, sequences: [next] }).success).toBe(true)
  })
  it('静态片段入点裁剪保持绝对内容边界，缩短出点只裁切可见范围', () => {
    const { document, sequence } = fixture()
    const trimmed = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['clip'], mode: 'in', delta: 40 })
    expect(trimmed.captions![0]).toMatchObject({ start: 70, duration: 30 }); expect(trimmed.markers![0].frame).toBe(70)
    document.sequences = [trimmed]
    const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['clip'], mode: 'out', delta: -30 })
    expect(next.captions![0]).toMatchObject({ start: 70, duration: 20 })
  })
  it('复制与粘贴只携带clip对象，跨序列有理帧率独立换算新引用', () => {
    const { document, sequence } = fixture()
    const clipboard = copyVideoEditClips(document, sequence.id, ['clip'])
    expect(clipboard.markers).toHaveLength(1); expect(clipboard.captions).toHaveLength(1)
    const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard, frame: 150, mode: 'paste' })
    expect(next.captions!.at(-1)).toMatchObject({ start: 170, duration: 50 })
    expect(next.captions!.at(-1)!.clipId).not.toBe('clip'); expect(next.markers!.at(-1)!.frame).toBe(190)
    expect(videoEditDocumentSchema.safeParse({ ...document, sequences: [next] }).success).toBe(true)
  })
  it('覆盖中间区间保留左右字幕，移除落在覆盖区间的clip标记', () => {
    const { document, sequence } = fixture(); const clipboard = copyVideoEditClips(document, sequence.id, ['clip'])
    clipboard.clips[0].duration = 20; clipboard.captions = []; clipboard.markers = []
    const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard, frame: 70, mode: 'overwrite' })
    expect(next.captions!.filter(caption => caption.clipId)).toMatchObject([{ start: 50, duration: 20 }, { start: 90, duration: 10 }])
    expect(next.markers!.filter(marker => marker.clipId)).toEqual([])
    expect(videoEditDocumentSchema.safeParse({ ...document, sequences: [next] }).success).toBe(true)
  })
  it('删除清除所属字幕/标记，保留独立序列内容；锁定覆盖附属内容', () => {
    const { document, sequence } = fixture()
    const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'delete', clipIds: ['clip'], ripple: true })
    expect(next.captions!.map(caption => caption.id)).toEqual(['program-caption']); expect(next.markers!.map(marker => marker.id)).toEqual(['program-marker'])
    sequence.tracks[1].locked = true
    const altered = structuredClone(document); altered.sequences[0].captions![0].text = '篡改'
    expect(() => assertVideoEditLockedTracks(document, altered)).toThrow('锁定')
  })
  it('公共原子start/source写入复用源时间映射；已有显式字幕写入不被覆盖', () => {
    const { document } = fixture(); const next = structuredClone(document); next.sequences[0].clips[0].start += 30
    expect(reconcileVideoEditTimedContent(document, next).sequences[0].captions![0].start).toBe(80)
    next.sequences[0].captions![0].start = 90
    expect(reconcileVideoEditTimedContent(document, next).sequences[0].captions![0].start).toBe(90)
  })
  it('帧率变更一次换算端点，字幕烧录半开，尾部内容决定导出时长', () => {
    const { sequence } = fixture()
    const next = changeVideoEditSequenceSettings(sequence, { frameRate: { numerator: 60000, denominator: 1001 } })
    expect(next.captions![0]).toMatchObject({ start: 100, duration: 100 }); expect(next.markers![0].frame).toBe(140)
    expect(videoEditCaptionClips(sequence, 99)).toHaveLength(1); expect(videoEditCaptionClips(sequence, 100)).toEqual([])
    sequence.captions!.push({ id: 'tail', start: 200, duration: 30, text: '片尾' }); expect(videoEditDuration(sequence)).toBe(230)
  })
})

describe('SRT/WebVTT真实交换', () => {
  it('解析CRLF/BOM/多行、VTT注释和plain格式，准确微秒端点', () => {
    expect(parseSubtitleText('\uFEFF1\r\n00:00:01,001 --> 00:00:02,003\r\n中文\r\n第二行')).toEqual([{ startUs: 1001000, endUs: 2003000, text: '中文\n第二行' }])
    expect(parseSubtitleText('WEBVTT\n\nNOTE 原注释\n忽略\n\ncue-a\n00:01.001 --> 00:02.003 align:center\n<b>中</b>&amp;文')).toEqual([{ startUs: 1001000, endUs: 2003000, text: '中&文' }])
  })
  it('NTSC导入/保存/输出重新解析保持帧边界，不累计舍入', () => {
    const { sequence } = fixture(); sequence.frameRate = { numerator: 30000, denominator: 1001 }
    sequence.captions = importVideoEditCaptions('1\n00:00:01,001 --> 00:00:02,002\n原创字幕', sequence.frameRate)
    expect(sequence.captions[0]).toMatchObject({ start: 30, duration: 30 })
    for (const format of ['srt', 'vtt'] as const) expect(importVideoEditCaptions(exportVideoEditCaptions(sequence, format), sequence.frameRate)[0]).toMatchObject({ start: 30, duration: 30, text: '原创字幕' })
  })
  it('导出范围裁切字幕端点并从入点计时，范围外字幕不输出', () => {
    const { sequence } = fixture(); sequence.frameRate = { numerator: 30, denominator: 1 }
    sequence.captions = importVideoEditCaptions('1\n00:00:00,000 --> 00:00:01,000\n前\n\n2\n00:00:01,500 --> 00:00:03,000\n跨', sequence.frameRate)
    expect(exportVideoEditCaptions(sequence, 'srt', { startFrame: 30, endFrame: 60 })).toBe('1\n00:00:00,500 --> 00:00:01,000\n跨\n')
    expect(exportVideoEditCaptions(sequence, 'vtt', { startFrame: 90, endFrame: 120 })).toBe('WEBVTT\n\n')
  })
  it('无效/零长/空文件和小于一帧及超范围字幕拒绝，不静默丢内容', () => {
    expect(() => parseSubtitleText('')).toThrow('没有')
    expect(() => parseSubtitleText('1\n00:99:01,000 --> 00:00:02,000\n非法')).toThrow('时间无效')
    expect(() => parseSubtitleText('1\n00:00:01,000 --> 00:00:01,000\n零长')).toThrow('正时长')
    expect(() => importVideoEditCaptions('1\n00:00:00,001 --> 00:00:00,002\n短', { numerator: 30, denominator: 1 })).toThrow('范围')
    expect(() => parseSubtitleText('1\n00:00:00,000 --> 00:00:01,000\n' + '<'.repeat(32769))).toThrow('原始文字')
    expect(() => parseSubtitleText('1\n00:00:00,000 --> 00:00:01,000\n' + '<'.repeat(2001))).toThrow('2000')
  })
})
