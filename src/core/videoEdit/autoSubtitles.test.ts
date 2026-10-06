import { describe, expect, it } from 'vitest'
import { buildAutoSubtitles, wrapSubtitleText, splitSubtitleText, audioTimestampToVideoFrame } from './autoSubtitles'
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
    expect(wrapSubtitleText('中文Hello world字幕', 8)).toBe('中文Hello\nworld字幕')
    expect(wrapSubtitleText('这是一句测试。', 7).split('\n').every(line => !/^[。！？]/.test(line))).toBe(true)
    const cues = buildAutoSubtitles([word('Hello', 0, 500), word('world.', 500, 1000), word('Next', 1500, 2000)], 1000, { numerator: 25, denominator: 1 }, { startFrame: 0, endFrame: 75 })
    expect(cues.map(cue => cue.text)).toEqual(['Hello world.', 'Next'])
  })
  it('句段长句按字数估算拆分，短句只延长空隙，不侵入下一句', () => {
    const cues = buildAutoSubtitles([{ ...word('这是一段没有逐词时间戳的识别结果', 0, 200), granularity: 'segment' }, word('下一句', 500, 800)], 1000, { numerator: 30, denominator: 1 }, { startFrame: 90, endFrame: 120 }, { maxCharacters: 6, minDurationSeconds: 1 })
    expect(cues).toHaveLength(3); expect(cues[0]).toMatchObject({ start: 90, duration: 5 }); expect(cues[0].text).toContain('\n')
    expect(cues[1].start + cues[1].duration).toBe(105)
    expect(cues[2].start + cues[2].duration).toBe(120)
  })
  it('中文句读优先拆分，中英文行数受限且不丢文字，超长英文词可按字拆', () => {
    expect(splitSubtitleText('欢迎来到，这里继续，最后结束。', 6, 2)).toEqual(['欢迎来到，\n这里继续，', '最后结束。'])
    expect(splitSubtitleText('欢迎来到，接下来的内容没有句读结束', 6, 2)[0]).toBe('欢迎来到，')
    const english = splitSubtitleText('Hello friend, today we edit subtitles together.', 14, 1)
    expect(english.every(cue => Array.from(cue).length <= 14)).toBe(true)
    expect(english.join(' ')).toBe('Hello friend, today we edit subtitles together.')
    expect(splitSubtitleText('supercalifragilistic', 5, 1).join('')).toBe('supercalifragilistic')
    expect(() => splitSubtitleText('text', 4, 4)).toThrow('1–3')
  })
  it('非均匀词级时刻优先于字数比例，并保留真实停顿', () => {
    const cues = buildAutoSubtitles([word('Alpha', 0, 100), word('Beta', 100, 600), word('Gamma', 800, 1000)], 1000, { numerator: 30, denominator: 1 }, { startFrame: 0, endFrame: 60 }, { maxCharacters: 5, maxLines: 1, pauseSeconds: 1, minDurationSeconds: 0 })
    expect(cues.map(cue => [cue.text, cue.start, cue.duration])).toEqual([['Alpha', 0, 3], ['Beta', 3, 15], ['Gamma', 24, 6]])
    const paused = buildAutoSubtitles([word('Hi', 0, 100), word('there', 700, 1000)], 1000, { numerator: 30, denominator: 1 }, { startFrame: 0, endFrame: 60 }, { pauseSeconds: .5, minDurationSeconds: 0 })
    expect(paused).toHaveLength(2)
  })
  it('段级比例换算共用绝对边界、裁剪范围，不丢尾字；不足一帧时拒绝而非丢字幕', () => {
    const text = '甲乙丙丁戊己庚辛壬癸'
    const cues = buildAutoSubtitles([{ ...word(text, 0, 1000), granularity: 'segment' }], 1000, { numerator: 30000, denominator: 1001 }, { startFrame: 60, endFrame: 85 }, { maxCharacters: 4, maxLines: 1, minDurationSeconds: 0 })
    expect(cues.map(cue => [cue.start, cue.duration])).toEqual([[60, 12], [72, 12], [84, 1]])
    expect(cues.map(cue => cue.text).join('')).toBe(text)
    expect(() => buildAutoSubtitles([{ ...word(text, 0, 20), granularity: 'segment' }], 1000, { numerator: 30, denominator: 1 }, { startFrame: 0, endFrame: 30 }, { maxCharacters: 4, maxLines: 1 })).toThrow('时长不足')
  })
  it('三行上限和第二语言共同约束烧录与导出，译文改变淘汰图形缓存', () => {
    const sequence = { ...createVideoEditSequence(), captions: [{ id: 'bilingual', start: 0, duration: 30, text: '你好', translation: 'Hello', style: videoEditSubtitleStyleSchema.parse({}) }] }
    const first = videoEditCaptionClips(sequence, 0)[0]
    expect(first.graphic?.objects.filter(object => object.name === '字幕文字').map(object => object.parameters.text)).toEqual(['你好', 'Hello'])
    expect(exportVideoEditCaptions(sequence)).toContain('你好\nHello')
    sequence.captions[0].translation = 'Hi'
    expect(videoEditCaptionClips(sequence, 0)[0].graphic).not.toBe(first.graphic)
    expect(() => videoEditCaptionSchema.parse({ ...sequence.captions[0], text: '一\n二\n三' })).toThrow('三行')
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
