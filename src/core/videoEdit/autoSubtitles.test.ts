import { describe, expect, it } from 'vitest'
import { buildAutoSubtitles, wrapSubtitleText, audioTimestampToVideoFrame } from './autoSubtitles'
import { createVideoEditSequence } from './document'
import { exportVideoEditCaptions, videoEditCaptionClips, videoEditCaptionSchema } from './timedContent'
import { videoEditSubtitleStyleSchema } from './subtitleStyle'
import { videoEditGraphicSchema, prepareVideoEditGraphic, evaluateVideoEditGraphic } from './graphics'
import type { AudioEditTranscriptBlock } from '../audioEdit/types'

const word = (text: string, startFrame: number, endFrame: number): AudioEditTranscriptBlock => ({ id: text, text, startFrame, endFrame, included: true, locked: false, granularity: 'word' })
describe('自动字幕分行与节目时间', () => {
  it('中文按标点断句、长句每行受限，时间只取已有词边界', () => {
    const cues = buildAutoSubtitles([word('你好，', 0, 800), word('欢迎来到痕迹。', 800, 2000), word('继续剪辑', 2100, 3000)], 1000, { numerator: 30, denominator: 1 }, { startFrame: 60, endFrame: 180 }, { maxCharacters: 8 })
    expect(cues).toHaveLength(2); expect(cues[0]).toMatchObject({ start: 60, duration: 60 })
    expect(cues.flatMap(cue => cue.text.split('\n')).every(line => Array.from(line).length <= 8)).toBe(true)
    expect(cues[1]).toMatchObject({ start: 123, duration: 30 })
  })
  it('英文尽量不拆单词，保留词间空格与句读', () => {
    expect(wrapSubtitleText('Hello world. This is a test!', 12)).toBe('Hello world.\nThis is a\ntest!')
    expect(wrapSubtitleText('Hello,friend!', 24)).toBe('Hello, friend!')
    expect(wrapSubtitleText('这是一句测试。', 7).split('\n').every(line => !/^[。！？]/.test(line))).toBe(true)
    const cues = buildAutoSubtitles([word('Hello', 0, 500), word('world.', 500, 1000), word('Next', 1500, 2000)], 1000, { numerator: 25, denominator: 1 }, { startFrame: 0, endFrame: 75 })
    expect(cues.map(cue => cue.text)).toEqual(['Hello world.', 'Next'])
  })
  it('句段只折行，不杜撰细粒度时间，短句不侵入下一句', () => {
    const cues = buildAutoSubtitles([{ ...word('这是一段没有逐词时间戳的识别结果', 0, 200), granularity: 'segment' }, word('下一句', 500, 800)], 1000, { numerator: 30, denominator: 1 }, { startFrame: 90, endFrame: 120 }, { maxCharacters: 6, minDurationSeconds: 1 })
    expect(cues).toHaveLength(2); expect(cues[0]).toMatchObject({ start: 90, duration: 15 }); expect(cues[0].text).toContain('\n')
    expect(cues[1].start + cues[1].duration).toBe(120)
  })
  it('有理帧率一次换算、合并秒边界并拒绝错误采样率', () => {
    expect(audioTimestampToVideoFrame(48048, 48000, { numerator: 30000, denominator: 1001 })).toBe(30)
    expect(audioTimestampToVideoFrame(48000000, 48000, { numerator: 30000, denominator: 1001 })).toBe(29970)
    expect(() => audioTimestampToVideoFrame(0, 0, { numerator: 30, denominator: 1 })).toThrow('无效')
  })
  it('SRT按序列时间排序裁剪，也保留既有从入点计时选项', () => {
    const sequence = { ...createVideoEditSequence(), captions: [{ id: 'b', start: 90, duration: 30, text: 'Second' }, { id: 'a', start: 30, duration: 60, text: '第一行\n第二行' }] }
    const srt = exportVideoEditCaptions(sequence, 'srt', { startFrame: 60, endFrame: 120, clock: 'sequence' })
    expect(srt).toContain('1\n00:00:02,000 --> 00:00:03,000\n第一行\n第二行')
    expect(srt).toContain('2\n00:00:03,000 --> 00:00:04,000\nSecond')
    expect(exportVideoEditCaptions(sequence, 'srt', { startFrame: 60, endFrame: 120 })).toContain('00:00:00,000 --> 00:00:01,000')
  })
  it('带样式字幕复用合成文字与底框，正式schema拒绝超出渲染预算的长行数', () => {
    const sequence = { ...createVideoEditSequence(), captions: [{ id: 'styled', start: 0, duration: 30, text: '一行\nTwo', style: videoEditSubtitleStyleSchema.parse({ background: true }) }] }
    const clip = videoEditCaptionClips(sequence, 0)[0]
    expect(clip).toMatchObject({ kind: 'graphic', y: 0, scale: 1 })
    expect(videoEditCaptionClips(sequence, 1)[0].graphic).toBe(clip.graphic)
    const graphic = videoEditGraphicSchema.parse(clip.graphic)
    const commands = evaluateVideoEditGraphic(prepareVideoEditGraphic(graphic), { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } })
    expect(commands.some(value => value.command.kind === 'rect')).toBe(true)
    expect(commands.filter(value => value.command.kind === 'text')).toHaveLength(18)
    expect(() => videoEditCaptionSchema.parse({ ...sequence.captions[0], text: '1\n2\n3\n4' })).toThrow('三行')
  })
})
