import { describe, expect, it } from 'vitest'
import realTakes from './__fixtures__/retake-takes.json'
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

  it('念坏那遍前面的“哎”跟着那一遍一起删', () => {
    const spoken = speak('这个 就叫 少即是多 吧。', { pause: 300 }, '哎，', { pause: 150 }, '不过 呢 为了 做到 答案 的 简单，', { pause: 600 }, '不过 呢 为了 做到 答案 的 简单 且 准确，')
    expect(keptText(spoken, detect(spoken))).toBe('这个就叫少即是多吧。不过呢为了做到答案的简单且准确，')
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

  it('引子后 8 字以上原样重现时，前后只有一般的停顿也删除；更短的仍要求明显停顿', () => {
    const spoken = speak('也都 说 清楚 了。', { pause: 100 }, '如果 查到了 能 对比 的。', { pause: 230 }, '那 这里 呢，你 会 发现，', { pause: 150 }, '如果 查到了 能 对比 的 数据 啊')
    expect(keptText(spoken, detect(spoken))).toBe('也都说清楚了。那这里呢，你会发现，如果查到了能对比的数据啊')
    const short = speak('也都 说 清楚 了。', { pause: 100 }, '能 对比 的。', { pause: 230 }, '那 这里 呢，你 会 发现，', { pause: 150 }, '能 对比 的 数据 啊')
    expect(detect(short)).toEqual([])
  })

  it('同一个英文名一遍识别成字母、一遍识别成同音汉字，照样按重念处理', () => {
    const spoken = speak('像是 元宝 的 app，', { pause: 120 }, '还有 ima， work8。', { pause: 400 }, '还有 艾 玛， workbody 用的 都是 它')
    expect(keptText(spoken, detect(spoken))).toBe('像是元宝的app，还有艾玛，workbody用的都是它')
  })

  it('紧贴在念坏那遍开头的“那个”一起删，和那遍之间有停顿时保留', () => {
    const attached = speak('一大 原因，', { pause: 300 }, '那个 说实话。', { pause: 1500 }, '说实话， 接入 元宝 搜索 这 一步 呢')
    expect(keptText(attached, detect(attached))).toBe('一大原因，说实话，接入元宝搜索这一步呢')
    const separate = speak('一大 原因，', { pause: 300 }, '那个，', { pause: 300 }, '说实话。', { pause: 1500 }, '说实话， 接入 元宝 搜索 这 一步 呢')
    expect(keptText(separate, detect(separate))).toBe('一大原因，那个，说实话，接入元宝搜索这一步呢')
  })

  it('删除段左边贴着的一两个字（前面有气口）跟着念坏那遍删，不留下去接几秒后的另一遍', () => {
    const spoken = speak('探索 不同 的 方向。', { pause: 400 }, '那 这个 工具 最 重要 的 部分 呢，', { pause: 900 }, '这 工具 最 重要 的 部分 就是 搜索 api 了')
    expect(keptText(spoken, detect(spoken))).toBe('探索不同的方向。这工具最重要的部分就是搜索api了')
    // 后一遍本来就以它开头时，它是重念的一部分，照常留最后一遍
    const same = speak('探索 不同 的 方向。', { pause: 400 }, '那 这个 工具 最 重要 的 部分 呢，', { pause: 900 }, '那 这 工具 最 重要 的 部分 就是 搜索')
    expect(keptText(same, detect(same))).toBe('探索不同的方向。那这工具最重要的部分就是搜索')
  })

  it('呼吸声也算气口：两遍之间没有安静、只有一口气时，切点落在呼吸里而不是硬接', () => {
    const spoken = speak('从 千兆 交换机 的 重 从 千兆 交换机 的 重点 参数')
    const restart = spoken.blocks[5].startFrame
    const retakes = detect(spoken, { breaths: [{ startMs: restart - 260, endMs: restart }] })
    expect(retakes).toHaveLength(1)
    expect(retakes[0].joined).toBe(false)
    expect(retakes[0].endFrame).toBeLessThanOrEqual(restart)
  })

  it('接缝连读时把删除窗口平移到两遍相同的内容里，让两头都落在停顿上；整遍相同时仍留最后一遍', () => {
    const spoken = speak('比我 想象 的 简单 太多 了一个 API KEY。', { pause: 800 }, '一个 API KEY 发个 HTTPS 请求，', { pause: 300 }, '发个 HTTP 请求， 结果 就 回来了')
    const retakes = detect(spoken)
    expect(keptText(spoken, retakes)).toBe('比我想象的简单太多了一个APIKEY。发个HTTP请求，结果就回来了')
    expect(retakes.every((retake) => !retake.joined)).toBe(true)
    expect(textOf(spoken, retakes.flatMap((retake) => retake.blockIds))).toBe('一个APIKEY发个HTTPS请求，')
    const repeated = speak('思路 清晰，并且 可以 随时 调整。', { pause: 500 }, '思路 清晰，并且 可以 随时 调整，', { pause: 200 }, '并且 你 肯定 也 看到了')
    const kept = detect(repeated)
    expect(kept).toHaveLength(1)
    expect(textOf(repeated, kept[0].blockIds)).toBe('思路清晰，并且可以随时调整。')
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

  it('不该删的正常重复：排比、承上启下、拆开的叠词不自动删；拿不准的只留作线索', () => {
    // 同一个开头的并列（没有参考稿）：只提线索，不删
    const parallel = speak('比如说 你 要 查 天气，', { pause: 300 }, '比如说 你 要 查 新闻， 它 都 能 找 到')
    const found = detect(parallel)
    expect(found.filter((retake) => !retake.review)).toEqual([])
    expect(found.every((retake) => retake.confidence === 'low')).toBe(true)
    // 稿子里两句都有：连线索都不提
    expect(detect(parallel, { referenceScript: '比如说你要查天气，比如说你要查新闻，它都能找到。' })).toEqual([])
    // “要等到2027年，那2027年到底什么时候买”：前一句的末尾被下一句承接，不是重念
    expect(detect(speak('要 等到 2 0 2 7 年，', { pause: 140 }, '那 2 0 2 7 年 到底 什么 时候 买 合适 呢'))).toEqual([])
    // “清清楚楚”被识别拆成“清｜清楚楚”，不当口吃
    expect(detect(speak('写 得 清', '清楚楚 的'))).toEqual([])
    // 临场加的一句话与稿子下一句同一个开头，稿子里没有这句：留作线索，不自动删
    const adlib = speak('但是 并不代表 它 处理 的 内容 就 很少 嘛。', { pause: 540 }, '但是 呢， 如果 你 觉得 这个 答案 太 短 了')
    expect(detect(adlib, { referenceScript: '回答虽然很短。但是呢，如果你觉得这个答案太短了，还可以点开。' }).filter((retake) => !retake.review)).toEqual([])
  })

  it('句级转写不做逐词检测', () => {
    const spoken = speak('所以 综合 来看', { pause: 500 }, '所以 综合 来看 很好')
    expect(detect({ ...spoken, blocks: spoken.blocks.map((block) => ({ ...block, granularity: 'segment' as const })) })).toEqual([])
  })
})

/*
 * 上一支片子第二版口播（12:45）的真实样本：识别原文、本机能量分析的停顿、呼吸检测结果，各取一段时间窗（从窗口开头计时），
 * 加上附近的参考稿。每条写明必须删掉的前一遍（含夹在两遍之间的碎话）与必须留下的最后一遍开头，取自用户精修后的成片。
 */
interface RealTakeWindow { name: string; remove: string; keep: string; words: Array<[string, number, number]>; pauses: Array<[number, number]>; breaths: Array<[number, number]>; script: string }
const fixture = realTakes as unknown as { sampleRate: number; windows: RealTakeWindow[] }

describe('真实口播的去重念回归', () => {
  it.each(fixture.windows.map((window) => [window.name, window] as const))('%s', (_name, window) => {
    const blocks: AudioEditTranscriptBlock[] = window.words.map(([text, startFrame, endFrame], index) => ({ id: `w${index}`, text, startFrame, endFrame, included: true, locked: false, granularity: 'word' }))
    const retakes = detectAudioEditRetakes(blocks, {
      sampleRate: fixture.sampleRate, referenceScript: window.script,
      pauses: window.pauses.map(([startMs, endMs]) => ({ startMs, endMs, cutMs: (startMs + endMs) / 2 })),
      breaths: window.breaths.map(([startMs, endMs]) => ({ startMs, endMs, peak: 1 })),
    })
    const removed = new Set(retakes.filter((retake) => !retake.review).flatMap((retake) => retake.blockIds))
    // 按文字定位：把窗口里的词连成一串，找到要核对的那一段，看它覆盖的词是删还是留
    const plain = (text: string): string => [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).join('')
    const owners: number[] = []
    blocks.forEach((block, index) => { for (const _ of plain(block.text)) owners.push(index) })
    const all = blocks.map((block) => plain(block.text)).join('')
    const wordsOf = (text: string, from = 0): number[] => {
      const at = all.indexOf(plain(text), from)
      expect(at, text).toBeGreaterThanOrEqual(0)
      return [...new Set(owners.slice(at, at + plain(text).length))]
    }
    const target = wordsOf(window.remove)
    expect(target.filter((index) => !removed.has(blocks[index].id)).map((index) => blocks[index].text), '应删未删').toEqual([])
    if (window.keep) {
      const kept = wordsOf(window.keep, owners.indexOf(target.at(-1)!) + 1)
      expect(kept.filter((index) => removed.has(blocks[index].id)).map((index) => blocks[index].text), '应留被删').toEqual([])
    }
  })
})
