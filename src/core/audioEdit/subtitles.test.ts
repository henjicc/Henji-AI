import { describe, expect, it } from 'vitest'
import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from './types'
import { buildAudioEditSubtitleGroups, formatAudioEditCaptions } from './captions'
import { buildAudioEditSubtitleCues, buildProjectAudioEditSubtitleCues, formatAudioEditSubtitleText } from './subtitles'
import { describeAudioEditCaptions, setAudioEditCaptionText } from './captionReview'
import { buildAudioEditTimeline } from './timeline'

/*
 * 成片字幕：按参考稿断句（一行一句）、排版（中英文空格、行尾标点、叹词不上字幕）、间隔短于 0.5 秒接上，
 * 以及逐段核对时改字写回词块。采样率 1000：帧即毫秒。
 */

const blocksOf = (texts: string[], gap = 20): AudioEditTranscriptBlock[] => texts.map((text, index) => ({
  id: `w${index}`, text, startFrame: index * (200 + gap), endFrame: index * (200 + gap) + 200, included: true, locked: false, granularity: 'word',
}))
const projectOf = (blocks: AudioEditTranscriptBlock[], referenceScript: string, cuts: AudioEditProjectDocument['cuts'] = []): AudioEditProjectDocument => ({
  id: 'p', name: '测试', referenceScript, transcript: blocks, suggestions: [], cuts, createdAt: 0, updatedAt: 0, revision: 1,
  source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', durationFrames: blocks.at(-1)!.endFrame + 1000, sampleRate: 1000, channels: 1 },
})
const lines = (project: AudioEditProjectDocument): string[] => buildAudioEditSubtitleGroups(project.transcript, 1000).map(group => group.text)

describe('按参考稿断句', () => {
  it('稿子的逗号、句号处换行，一行一句；识别给的错字不影响对齐', () => {
    const project = formatAudioEditCaptions(projectOf(blocksOf(['这是我', '最近', '做的', '一个', '工具', '它能', '让', 'AI', '给你', '最准', '确的', '答案']),
      '这是我最近做的一个工具，它能让 AI 给你最准确的答案。'))
    expect(lines(project)).toEqual(['这是我最近做的一个工具', '它能让AI给你最准确的答案'])
  })

  it('念的时候多带的句尾语气词跟着前一句；稿子标点落在词中间时按大半所在切', () => {
    const project = formatAudioEditCaptions(projectOf(blocksOf(['这个', '工具', '最重要的', '部分', '呢，', '就是搜', '索API了']),
      '这个工具最重要的部分，就是搜索 API 了。'))
    expect(lines(project)).toEqual(['这个工具最重要的部分呢，', '就是搜索API了'])
    const middle = formatAudioEditCaptions(projectOf(blocksOf(['做的', '一个', '工具它', '能让', '你']), '做的一个工具，它能让你'))
    expect(lines(middle)).toEqual(['做的一个工具它', '能让你'])
  })

  it('被删掉的重念不打断句子；过长的一句在中间附近最明显的停顿处拆开', () => {
    const blocks = blocksOf(['我', '想', '既然', '这些', '既然', '这些', '大产品', '都在用'])
    blocks[2].included = false
    blocks[3].included = false
    expect(lines(formatAudioEditCaptions(projectOf(blocks, '我想既然这些大产品都在用。')))).toEqual(['我想既然这些大产品都在用'])
    const long = blocksOf(['每个节点', '都会调用', '大模型', '以及', '搜索引擎', '来确保', '回答的', '准确性', '和及时性'])
    long[5] = { ...long[5], startFrame: long[4].endFrame + 400, endFrame: long[4].endFrame + 600 }
    for (let index = 6; index < long.length; index++) long[index] = { ...long[index], startFrame: long[index - 1].endFrame + 20, endFrame: long[index - 1].endFrame + 220 }
    const split = lines(formatAudioEditCaptions(projectOf(long, '每个节点都会调用大模型以及搜索引擎来确保回答的准确性和及时性。')))
    expect(split).toEqual(['每个节点都会调用大模型以及搜索引擎', '来确保回答的准确性和及时性'])
  })
})

describe('成片字幕排版与时间', () => {
  it('中文与英文、数字之间加空格，去掉行首和行尾的逗号句号，问号保留', () => {
    expect(formatAudioEditSubtitleText('，比如最近php那个漏洞，')).toBe('比如最近 php 那个漏洞')
    expect(formatAudioEditSubtitleText('0.3秒就返回了20条结果。')).toBe('0.3 秒就返回了 20 条结果')
    expect(formatAudioEditSubtitleText('为什么还非得接个搜索呢？')).toBe('为什么还非得接个搜索呢？')
    expect(formatAudioEditSubtitleText('关键是呢，它还会搜 php.net。也就 0.3 秒')).toBe('关键是呢 它还会搜 php.net 也就 0.3 秒')
  })

  it('换遍拼接时只剩一丝的字头不上字幕；稿子里 php.net 的点不算断句', () => {
    const blocks = blocksOf(['但', '结果', '说的', '还挺对的'])
    // “但”只留下 10 毫秒（拼接点贴着字头）
    const cuts = [{ id: 'c', startFrame: blocks[0].startFrame + 10, endFrame: blocks[1].startFrame, reason: 'manual' as const, enabled: true }]
    expect(buildProjectAudioEditSubtitleCues(projectOf(blocks, '', cuts)).map(cue => cue.text)).toEqual(['结果说的还挺对的'])
    const project = formatAudioEditCaptions(projectOf(blocksOf(['只搜', 'php', '点', 'net', '那些', '文章', '都避开了']), '只搜 php.net，那些文章都避开了'))
    expect(lines(project)).toEqual(['只搜php点net', '那些文章都避开了'])
  })

  it('单独的叹词不上字幕；间隔短于 0.5 秒接到下一条开始，更长的留空；字尾被剪掉一点的词仍在', () => {
    const blocks = blocksOf(['哎，', '你看', '答案', '出来了，', '然后', '底下'])
    blocks[2].captionBreakAfter = false
    blocks[3].captionBreakAfter = true
    blocks[1].captionBreakAfter = true
    blocks[4] = { ...blocks[4], startFrame: blocks[3].endFrame + 800, endFrame: blocks[3].endFrame + 1000 }
    blocks[5] = { ...blocks[5], startFrame: blocks[4].endFrame + 20, endFrame: blocks[4].endFrame + 220 }
    // 把“出来了”的最后 50 毫秒剪掉
    const cuts = [{ id: 'c', startFrame: blocks[3].endFrame - 50, endFrame: blocks[3].endFrame + 100, reason: 'manual' as const, enabled: true }]
    const project = projectOf(blocks, '', cuts)
    const cues = buildProjectAudioEditSubtitleCues(project)
    expect(cues.map(cue => cue.text)).toEqual(['你看', '答案出来了', '然后底下'])
    expect(cues[0].startFrame).toBe(blocks[1].startFrame)
    expect(cues[0].endFrame).toBe(cues[1].startFrame)
    expect(cues[1].words.map(word => word.text)).toEqual(['答案', '出来了，'])
    expect(cues[2].startFrame - cues[1].endFrame).toBe(700)
    const spans = buildAudioEditTimeline(project.source.durationFrames, project.transcript, project.cuts)
    expect(buildAudioEditSubtitleCues(project.transcript, spans, 1000).map(cue => cue.text)).toEqual(cues.map(cue => cue.text))
  })
})

describe('逐段核对与改字', () => {
  it('列出每段的稿子原文与是否一致；改字逐字写回原词块，时间不变', () => {
    const project = formatAudioEditCaptions(projectOf(blocksOf(['还有', '艾玛，', 'work', 'body', '用的', '都是它']), '还有 ima、WorkBuddy，用的都是它。'))
    const views = describeAudioEditCaptions(project)
    expect(views.map(view => [view.text, view.scriptMatch])).toEqual([['还有艾玛 work body', 'different'], ['用的都是它', 'same']])
    expect(views[0].scriptText).toBe('还有 ima、WorkBuddy，')
    const fixed = setAudioEditCaptionText(project, views[0].id, '还有 ima、WorkBuddy')
    expect(fixed.transcript.slice(0, 4).map(block => block.text)).toEqual(['还有', 'ima、', 'WorkBuddy', ''])
    expect(fixed.transcript.map(block => block.startFrame)).toEqual(project.transcript.map(block => block.startFrame))
    expect(describeAudioEditCaptions(fixed)[0].text).toBe('还有 ima、WorkBuddy')
    const whole = setAudioEditCaptionText(fixed, views[0].id, '还有 ima、WorkBuddy')
    expect(whole).toEqual(fixed)
    expect(() => setAudioEditCaptionText(project, views[0].id, '  ')).toThrow()
  })

  it('改字只落在听得到的词上：声音被剪掉的重念词块不动，改空的词块留在原段里', () => {
    const blocks = blocksOf(['比我', '比我', '想象的', '简单'])
    // 第一个“比我”的声音被剪掉（换遍拼接留后一遍），词块仍是保留状态
    const cuts = [{ id: 'c', startFrame: blocks[0].startFrame, endFrame: blocks[1].startFrame, reason: 'manual' as const, enabled: true }]
    const project = projectOf(blocks, '', cuts)
    const [view] = describeAudioEditCaptions(project)
    expect(view.text).toBe('比我想象的简单')
    const fixed = setAudioEditCaptionText(project, view.id, '比我想象的简单多了')
    expect(fixed.transcript.map(block => block.text)).toEqual(['比我', '比我', '想象的', '简单多了'])
    const emptied = setAudioEditCaptionText(fixed, view.id, '想象的简单多了')
    expect(emptied.transcript.map(block => block.text)).toEqual(['比我', '', '想象的', '简单多了'])
    expect(describeAudioEditCaptions(emptied).map(item => [item.id, item.text])).toEqual([[view.id, '想象的简单多了']])
    expect(buildProjectAudioEditSubtitleCues(emptied)[0].words.map(word => word.text)).toEqual(['想象的', '简单多了'])
    // 行尾原有的标点留在末尾，新加的字放在它前面
    const tail = projectOf(blocksOf(['或者', '说，']), '')
    const [line] = describeAudioEditCaptions(tail)
    const added = setAudioEditCaptionText(tail, line.id, '或者说呀')
    expect(added.transcript.map(block => block.text)).toEqual(['或者', '说呀，'])
    expect(describeAudioEditCaptions(added)[0].text).toBe('或者说呀')
  })
})
