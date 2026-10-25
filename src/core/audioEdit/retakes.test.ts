import { describe, expect, it } from 'vitest'
import type { SpeechEnergyPause } from './speechEnergy'
import type { AudioEditTranscriptBlock } from './types'
import { audioEditRetakeSuggestion, detectAudioEditRetakes, type AudioEditRetakeOptions } from './retakes'

type Part = string | { pause: number }

/** 按词拼一段口播：字符串里用空格分词，每字 80 毫秒、词首尾相连（与识别结果一致）；{ pause } 是真实停顿。采样率 1000，帧即毫秒。 */
function speak(...parts: Part[]): { blocks: AudioEditTranscriptBlock[]; pauses: SpeechEnergyPause[] } {
  const blocks: AudioEditTranscriptBlock[] = []
  const pauses: SpeechEnergyPause[] = []
  let at = 500
  pauses.push({ startMs: 0, endMs: at, cutMs: at / 2 })
  for (const part of parts) {
    if (typeof part !== 'string') {
      pauses.push({ startMs: at, endMs: at + part.pause, cutMs: at + part.pause / 2 })
      at += part.pause
      continue
    }
    for (const text of part.split(/\s+/).filter(Boolean)) {
      const length = [...text.replace(/[，。？！、…]/g, '')].length * 80 || 80
      blocks.push({ id: `w${blocks.length}`, text, startFrame: at, endFrame: at + length, included: true, locked: false, granularity: 'word' })
      at += length
    }
  }
  return { blocks, pauses }
}

function detect(spoken: ReturnType<typeof speak>, extra: Partial<AudioEditRetakeOptions> = {}) {
  return detectAudioEditRetakes(spoken.blocks, { sampleRate: 1000, pauses: spoken.pauses, ...extra })
}

const textOf = (spoken: ReturnType<typeof speak>, ids: readonly string[]): string => ids.map((id) => spoken.blocks.find((block) => block.id === id)!.text).join('')
const keptText = (spoken: ReturnType<typeof speak>, retakes: ReturnType<typeof detect>): string => {
  const removed = new Set(retakes.flatMap((retake) => retake.blockIds))
  return spoken.blocks.filter((block) => !removed.has(block.id)).map((block) => block.text).join('')
}

describe('口播重念检测', () => {
  it('整句重念留最后一遍，切点落在两遍之间的停顿里并留出气口', () => {
    const spoken = speak('所以 综合 来看 这个 工具 挺 不错 的。', { pause: 800 }, '所以 综合 来看 这个 工具 很 不错 的。')
    const retakes = detect(spoken)
    expect(retakes).toHaveLength(1)
    expect(textOf(spoken, retakes[0].blockIds)).toBe('所以综合来看这个工具挺不错的。')
    const lastRemoved = spoken.blocks.find((block) => block.id === retakes[0].blockIds.at(-1))!
    const repair = spoken.blocks[retakes[0].blockIds.length]
    expect(retakes[0].endFrame).toBe(repair.startFrame - 120)
    expect(retakes[0].endFrame).toBeGreaterThan(lastRemoved.endFrame)
    expect(retakes[0]).toMatchObject({ kind: 'restart', confidence: 'high', joined: false })
    expect(audioEditRetakeSuggestion(retakes[0])).toMatchObject({ kind: 'retake', evidence: 'audio', status: 'pending', blockIds: retakes[0].blockIds })
  })

  it('半句断开后重念，连同中间的语气词一起删除', () => {
    const spoken = speak('比如 最近 的 那个 漏洞 你看 哎', { pause: 400 }, '比如 最近 那个 漏洞 你看 他 就 查了 很多 官方 网站')
    const retakes = detect(spoken)
    expect(retakes).toHaveLength(1)
    expect(textOf(spoken, retakes[0].blockIds)).toBe('比如最近的那个漏洞你看哎')
  })

  it('连续三遍只留最后一遍，改词与同音字都能对上', () => {
    const spoken = speak('所以 我就 让他 搓了 这么 一个，', { pause: 300 }, '哎，', { pause: 200 }, '所以 我就 用它 搓了 这么 一个 小工具，', { pause: 300 }, '哎，', { pause: 200 }, '所以 我就 接入它 错了 这么 一个 小工具 啊。')
    const retakes = detect(spoken)
    expect(keptText(spoken, retakes)).toBe('所以我就接入它错了这么一个小工具啊。')
  })

  it('A B A B 交错重念收敛到最后一遍', () => {
    const spoken = speak('那 它 具体 是 怎么 查的 呢？', { pause: 300 }, '首先 大模型 呢，', { pause: 400 }, '那 它 具体 是 怎么 查的 呢？', { pause: 300 }, '首先 大模型 会 先 把 问题 拆开')
    expect(keptText(spoken, detect(spoken))).toBe('那它具体是怎么查的呢？首先大模型会先把问题拆开')
  })

  it('重念前加了引子：前面那段自成一句、后面几乎原样出现时删除，标为低置信', () => {
    const spoken = speak('如果 查到了 能 对比 的。', { pause: 600 }, '那 这里 呢 你 会 发现', { pause: 300 }, '如果 查到了 能 对比 的 数据 它 会 整理 成 表格')
    const retakes = detect(spoken)
    expect(keptText(spoken, retakes)).toBe('那这里呢你会发现如果查到了能对比的数据它会整理成表格')
    expect(retakes[0].confidence).toBe('low')
  })

  it('紧挨在重念前的半截起头一并删除', () => {
    const spoken = speak('我 还以为 搜不到 呢，', { pause: 300 }, '但这个', { pause: 300 }, '但 结果 说的 还是 挺准，', { pause: 500 }, '但 结果 说的 还是 挺对 的')
    expect(keptText(spoken, detect(spoken))).toBe('我还以为搜不到呢，但结果说的还是挺对的')
  })

  it('没有重起句的排比与并列不删', () => {
    expect(detect(speak('每条 搜了 什么，带了 什么 参数，回来 多少 条 都 清楚'))).toEqual([])
    expect(detect(speak('几十 个 行业，', { pause: 200 }, '几百 个 信源，', { pause: 200 }, '每天 几十亿 次 调用'))).toEqual([])
  })

  it('稿子里本来就连着出现的重复不删，没有稿子时按重念处理', () => {
    const spoken = speak('基本 都是 官网， 还有 专业 的 行业 媒体，', { pause: 300 }, '还有 专业 的 行业 网站')
    expect(detect(spoken).map((retake) => textOf(spoken, retake.blockIds))).toEqual(['还有专业的行业媒体，'])
    expect(detect(spoken, { referenceScript: '基本都是官网，还有专业的行业媒体，还有专业的行业网站。' })).toEqual([])
    expect(detect(spoken, { referenceScript: '基本都是官网、权威媒体，还有专业的行业网站。' })).toHaveLength(1)
  })

  it('锁定的词不删，已删除的词视为不存在，选区外不处理', () => {
    const spoken = speak('这个 呢 就是 节点 式 的 好处 了。', { pause: 500 }, '这个 就是 节点 式 的 好处 了，思路 清晰')
    const locked = { ...spoken, blocks: spoken.blocks.map((block, index) => index === 2 ? { ...block, locked: true } : block) }
    expect(detect(locked)).toEqual([])
    const excluded = { ...spoken, blocks: spoken.blocks.map((block, index) => index < 8 ? { ...block, included: false } : block) }
    expect(detect(excluded)).toEqual([])
    expect(detect(spoken, { range: { startFrame: spoken.blocks[9].startFrame, endFrame: spoken.blocks.at(-1)!.endFrame } })).toEqual([])
    expect(detect(spoken, { range: { startFrame: 0, endFrame: spoken.blocks.at(-1)!.endFrame } })).toHaveLength(1)
  })

  it('两遍之间没有真实停顿时切在词边界并标为连读', () => {
    const spoken = speak('从 千兆 交换机 的 重 从 千兆 交换机 的 重点 参数')
    const retakes = detect(spoken)
    expect(retakes).toHaveLength(1)
    expect(textOf(spoken, retakes[0].blockIds)).toBe('从千兆交换机的重')
    expect(retakes[0].joined).toBe(true)
    expect(retakes[0].endFrame).toBe(spoken.blocks[5].startFrame)
  })

  it('句级转写不做逐词检测', () => {
    const spoken = speak('所以 综合 来看', { pause: 500 }, '所以 综合 来看 很好')
    expect(detect({ ...spoken, blocks: spoken.blocks.map((block) => ({ ...block, granularity: 'segment' as const })) })).toEqual([])
  })
})
