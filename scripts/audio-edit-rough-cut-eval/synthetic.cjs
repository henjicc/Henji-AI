// 合成重念样本：从一段没有重念的干净口播出发，按“念坏了马上重念”的习惯插入带标注的重念，
// 用来弥补“没有算法没见过的定稿”。只合成词与时间（识别那样首尾相接、停顿另给），不合成声音，所以只评逐词结果。
const { strip } = require('./score.cjs')

const SENTENCE_END = /[。！？!?；;…]$/
const CLAUSE_END = /[，、：,:]$/
const MARKERS = [['哎，', 0.7], ['呃，', 0.15], ['不对，', 0.15]]

function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** 干净的词（text、durationMs）按标点分成分句。 */
function clauses(words) {
  const result = []
  let current = []
  for (const word of words) {
    current.push(word)
    if (SENTENCE_END.test(word.text.trim()) || CLAUSE_END.test(word.text.trim()) || current.length >= 14) { result.push(current); current = [] }
  }
  if (current.length) result.push(current)
  return result
}

/**
 * 生成一份样本。重念的类型：
 * - verbatim 念到一半停下，隔一会儿从这个分句开头原样重念；
 * - rephrase 开头相同、后面说成了别的话就停下，再按原句念；
 * - mid 不停顿或只停一下，从分句中间往回几个词重起；
 * - triple 同一句念坏两次，第三遍才念完；
 * - stutter 一个词的第一个字先单独蹦出来。
 * 重念前按概率带“哎 / 呃 / 不对”。另外按 scriptedRate 插入“稿子里本来就有的重复”（整句说两遍的强调、只换最后一个词的排比、
 * 一个词连说三遍的口号、换掉中间一个词的句子、换了开头与结尾的对比），它们同样写进参考稿，照稿念出来不是重念。
 * 返回词块、停顿、参考稿与每处重念的范围和应该剩下的文字、每处稿内重复的范围。
 */
function synthesize(cleanWords, { seed = 1, rate = 0.28, scriptedRate = 0.06, sampleRate = 44100 } = {}) {
  const next = random(seed)
  const between = (low, high) => low + next() * (high - low)
  const pick = (count) => Math.min(count - 1, Math.floor(next() * count))
  const groups = clauses(cleanWords)
  const blocks = [], pauses = [], retakes = [], markers = [], scripted = [], scriptParts = []
  let cursor = 500
  const emit = (text, durationMs, role) => { blocks.push({ id: `s${blocks.length}`, text, startMs: cursor, endMs: cursor + durationMs, role }); cursor += durationMs }
  const gap = (ms) => { if (ms >= 100) pauses.push({ startMs: cursor, endMs: cursor + ms, cutMs: cursor + ms / 2 }); cursor += ms }
  const naturalGap = (text) => gap(SENTENCE_END.test(text.trim()) ? between(350, 600) : CLAUSE_END.test(text.trim()) ? between(120, 250) : 0)
  const letters = (words) => strip(words.map((word) => word.text).join('')).length
  // 念坏的那遍：最后一个词拖长，识别给它的标点不定（没有、逗号或句号）
  const emitBroken = (words) => words.forEach((word, i) => {
    const last = i === words.length - 1
    emit(last ? word.text.replace(/[\p{P}\s]+$/u, '') + ['', '，', '。'][pick(3)] : word.text, word.durationMs * (last ? 1.3 : 1), 'take')
  })
  const emitMarker = (chance) => {
    if (next() >= chance) return
    let roll = next()
    const text = MARKERS.find(([, share]) => (roll -= share) < 0)?.[0] ?? MARKERS[0][0]
    markers.push({ index: blocks.length, text })
    emit(text, text.length * 110, 'marker')
    gap(between(80, 300))
  }
  const emitClean = (words) => words.forEach((word) => { emit(word.text, word.durationMs, 'clean'); naturalGap(word.text) })

  groups.forEach((group, groupIndex) => {
    const start = blocks.length
    const usable = letters(group) >= 4 && group.length >= 2
    const type = usable && next() < rate ? ['verbatim', 'verbatim', 'verbatim', 'rephrase', 'rephrase', 'rephrase', 'mid', 'mid', 'triple', 'stutter'][pick(10)] : undefined
    // 有意的重复都是说完一句再说：只拿带标点收尾的分句来做，凑够字数硬切出来的半句不算
    if (!type && usable && /[，。！？、；：,.!?;:]$/.test(group.at(-1).text.trim()) && next() < scriptedRate) {
      // 稿内重复：念的和稿子一致，整段都该留
      // 最后一个词只是语气词（“…简单啊，”）时换掉它等于后一遍接着往下说，那是重念的样子，不拿来当排比
      const lastIsParticle = /^[哎嗯呃额啊唉诶欸呀呢吧嘛哦]*$/.test(strip(group.at(-1).text))
      const drawn = pick(5)
      const kind = drawn === 1 && lastIsParticle ? 0 : drawn
      const donor = groups[(groupIndex + 5) % groups.length], other = donor[pick(donor.length)]
      const bare = { ...other, text: strip(other.text) || other.text }
      const swapped = { ...other, text: other.text.replace(/[\p{P}\s]+$/u, '') + (group.at(-1).text.match(/[\p{P}]+$/u)?.[0] ?? '') }
      const copies = kind === 0 ? [group, group]
        : kind === 1 ? [group, [...group.slice(0, -1), swapped]]
          : kind === 2 ? [[group[0]], [group[0]], group]
            // 对比、列举：换掉中间一个词（“一个人可以走得很快，一群人可以走得很远”）
            : kind === 3 ? [group, group.map((word, index) => (index === Math.floor(group.length / 2) && group.length > 2 ? bare : word))]
              // 换了开头的主语或序数、结尾也不同（“一个人可以走得很快，一群人可以走得很远”）
              : [group, [bare, ...group.slice(1, -1), swapped]]
      for (const copy of copies) { emitClean(copy); scriptParts.push(copy.map((word) => word.text).join('')) }
      // long：六个字以上的一句原样说两遍，或八个字以上只在中间换了一个词——和“念完觉得不好再念一遍”是同一个样子，没有稿子时分不清；
      // 其余（短句叠说、口号、只换最后一个词的排比、换了开头的对比）是结构上看得出的有意重复
      scripted.push({ start, end: blocks.length, long: (kind === 0 && letters(group) >= 6) || (kind === 3 && letters(group) >= 8) })
      return
    }
    scriptParts.push(group.map((word) => word.text).join(''))
    if (!type) { emitClean(group); return }
    const prefixEnd = (minLetters) => { let end = 1; while (end < group.length && letters(group.slice(0, end)) < minLetters) end++; return end }
    if (type === 'verbatim' || type === 'triple') {
      for (let round = type === 'triple' ? 2 : 1; round > 0; round--) {
        const stop = Math.max(prefixEnd(2), 1 + pick(group.length))
        emitBroken(group.slice(0, stop)); gap(between(500, 1500)); emitMarker(0.4)
      }
      emitClean(group)
    } else if (type === 'rephrase') {
      const donor = groups[(groupIndex + 3 + pick(Math.max(1, groups.length - 6))) % groups.length]
      const from = pick(Math.max(1, donor.length - 2))
      emitBroken([...group.slice(0, prefixEnd(2)), ...donor.slice(from, from + 2 + pick(3))]); gap(between(500, 1500)); emitMarker(0.4)
      emitClean(group)
    } else if (type === 'mid' && group.length >= 4) {
      const stop = 3 + pick(group.length - 2), back = 1 + pick(stop - 1)
      emitBroken(group.slice(0, stop)); gap(between(0, 250)); emitMarker(0.15)
      emitClean(group.slice(back))
    } else {
      const at = group.findIndex((word) => strip(word.text).length >= 2 && /^[一-鿿]/.test(word.text))
      if (at < 0) { emitClean(group); return }
      emitClean(group.slice(0, at)); emit(group[at].text[0], 150, 'take'); gap(between(0, 300)); emitClean(group.slice(at))
      retakes.push({ type: 'stutter', start, end: blocks.length, clean: group.map((word) => word.text).join('') })
      return
    }
    retakes.push({ type, start, end: blocks.length, clean: group.map((word) => word.text).join('') })
  })
  const frame = (ms) => Math.round(ms * sampleRate / 1000)
  return {
    sampleRate, channels: 1, durationFrames: frame(cursor + 500), referenceScript: scriptParts.join(''),
    blocks: blocks.map((block) => ({ id: block.id, text: block.text, startFrame: frame(block.startMs), endFrame: frame(block.endMs), role: block.role })),
    pauses, retakes, markers, scripted,
  }
}

/**
 * 打分：每处重念看它所在范围里剩下的文字是否正好等于干净原句（“哎、呃”不计）——剪法不同但文字相同算对。
 * 结果：resolved 剪对了；review 没剪对但提了待确认；missed 还留着多余的字；damaged 少了原句的字。
 * 重念范围之外删掉的实词算误删；其中落在“稿内重复”里的单独再数一次（scriptedDeleted：有稿时必须为 0）。
 */
function scoreSynthetic(sample, retakes) {
  const index = new Map(sample.blocks.map((block, i) => [block.id, i]))
  const deleted = new Uint8Array(sample.blocks.length), reviewed = new Uint8Array(sample.blocks.length)
  for (const retake of retakes) for (const id of retake.blockIds) (retake.review ? reviewed : deleted)[index.get(id)] = 1
  const plain = (text) => strip(text).replace(/[哎呃]/g, '')
  const byType = {}, failures = []
  const inRetake = new Uint8Array(sample.blocks.length)
  for (const retake of sample.retakes) {
    inRetake.fill(1, retake.start, retake.end)
    const kept = plain(sample.blocks.slice(retake.start, retake.end).filter((_, offset) => !deleted[retake.start + offset]).map((block) => block.text).join(''))
    const clean = plain(retake.clean)
    const outcome = kept === clean ? 'resolved' : reviewed.subarray(retake.start, retake.end).some(Boolean) ? 'review' : kept.length > clean.length ? 'missed' : 'damaged'
    const bucket = byType[retake.type] ??= { total: 0, resolved: 0, review: 0, missed: 0, damaged: 0 }
    bucket.total++; bucket[outcome]++
    if (outcome !== 'resolved') failures.push(`${retake.type} ${outcome}：${sample.blocks.slice(retake.start, retake.end).map((block, offset) => (deleted[retake.start + offset] ? `~${block.text}` : block.text)).join('|')}`)
  }
  let falseRuns = 0
  for (let i = 0; i < sample.blocks.length; i++) {
    const hit = deleted[i] && !inRetake[i] && plain(sample.blocks[i].text)
    if (hit && !(i > 0 && deleted[i - 1] && !inRetake[i - 1])) falseRuns++
  }
  const scriptedHit = sample.scripted.filter(({ start, end }) => sample.blocks.slice(start, end).some((block, offset) => deleted[start + offset] && plain(block.text)))
  for (const { start, end } of scriptedHit) failures.push(`有意重复被删：${sample.blocks.slice(Math.max(0, start - 3), end + 3).map((block, offset) => (deleted[Math.max(0, start - 3) + offset] ? `~${block.text}` : block.text)).join('|')}`)
  const scriptedDeleted = scriptedHit.length, longDeleted = scriptedHit.filter((item) => item.long).length, longTotal = sample.scripted.filter((item) => item.long).length
  const marker = { aiKept: 0, aiTotal: 0, otherDeleted: 0, otherTotal: 0 }
  for (const item of sample.markers) {
    if (item.text.startsWith('哎')) { marker.aiTotal++; if (!deleted[item.index]) marker.aiKept++ } else { marker.otherTotal++; if (deleted[item.index]) marker.otherDeleted++ }
  }
  const total = { total: 0, resolved: 0, review: 0, missed: 0, damaged: 0 }
  for (const bucket of Object.values(byType)) for (const key of Object.keys(total)) total[key] += bucket[key]
  return { byType, total, falseRuns, scriptedDeleted, scriptedTotal: sample.scripted.length, longDeleted, longTotal, marker, failures, reviewCount: retakes.filter((retake) => retake.review).length }
}

module.exports = { synthesize, scoreSynthetic }
