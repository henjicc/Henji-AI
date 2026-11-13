// 粗剪评估台的打分：把“算法删了什么、怎么切的”与定稿逐词、逐格（10 毫秒）比较。纯计算，不读写文件。

const FILLER_ONLY = /^[哎嗯呃额啊唉诶欸呀]*$/
const strip = (text) => text.replace(/[^\p{L}\p{N}]/gu, '')
const isFillerWord = (text) => FILLER_ONLY.test(strip(text))
const quantile = (values, ratio) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))] : 0

function runsOf(length, predicate) {
  const runs = []
  for (let index = 0; index < length;) {
    if (!predicate(index)) { index++; continue }
    let end = index
    while (end < length && predicate(end)) end++
    runs.push([index, end])
    index = end
  }
  return runs
}

/** 两段文字的相似度（相邻两字组成的集合的重合比例）。 */
function similarity(a, b) {
  const grams = (text) => { const set = new Set(); for (let i = 0; i + 1 < text.length; i++) set.add(text.slice(i, i + 2)); return set }
  const x = grams(a), y = grams(b)
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const gram of x) if (y.has(gram)) shared++
  return 2 * shared / (x.size + y.size)
}

/**
 * 逐词比较。类别：
 * - 整处漏删 / 整处误删：一整段该删没删、不该删删了；
 * - 留错遍：漏删的一段与误删的一段说的是同一句话（算法留了另一遍）；
 * - 接缝偏移：删除段的边界比定稿多走或少走了一到三个词；
 * - 语气词：只差在“哎、嗯、呃、啊”这类单独的语气词上。
 */
function scoreWords(blocks, sampleRate, finalDeleted, algoDeleted, reviews = []) {
  const count = blocks.length
  const seconds = ([start, end]) => (blocks[end - 1].endFrame - blocks[start].startFrame) / sampleRate
  const text = ([start, end]) => blocks.slice(start, end).map((block) => block.text).join('')
  const describe = (run) => {
    const [start, end] = run, at = blocks[start].startFrame / sampleRate
    const before = blocks.slice(Math.max(0, start - 6), start).map((block) => block.text).join('')
    const after = blocks.slice(end, end + 6).map((block) => block.text).join('')
    return `${Math.floor(at / 60)}:${(at % 60).toFixed(2).padStart(5, '0')} ${before}【${text(run)}】${after}`
  }
  const miss = runsOf(count, (i) => finalDeleted[i] && !algoDeleted[i]).map((run) => ({ run, kind: 'miss' }))
  const extra = runsOf(count, (i) => !finalDeleted[i] && algoDeleted[i]).map((run) => ({ run, kind: 'false' }))
  const diffs = [...miss, ...extra].sort((a, b) => a.run[0] - b.run[0])
  const inDiff = new Int32Array(count).fill(-1)
  diffs.forEach((diff, index) => { for (let i = diff.run[0]; i < diff.run[1]; i++) inDiff[i] = index })
  const common = (i) => i >= 0 && i < count && finalDeleted[i] && algoDeleted[i]
  // 往一侧跳过单独的语气词与标点，看贴着的是不是两边都删掉的内容，或另一类差异
  const neighbour = (from, step, own) => {
    let i = from
    while (i >= 0 && i < count && isFillerWord(blocks[i].text) && inDiff[i] < 0 && !common(i)) i += step
    return common(i) || (i >= 0 && i < count && inDiff[i] >= 0 && diffs[inDiff[i]].kind !== own)
  }
  for (const diff of diffs) {
    const [start, end] = diff.run
    diff.letters = strip(text(diff.run)).length
    diff.filler = blocks.slice(start, end).every((block) => isFillerWord(block.text))
    diff.atSeam = neighbour(start - 1, -1, diff.kind) || neighbour(end, 1, diff.kind)
  }
  // 留错遍：一段漏删配一段误删，说的是同一句（各自至少四个字、相隔 20 秒以内）
  for (const a of diffs) {
    if (a.kind !== 'miss' || a.filler || a.letters < 4 || a.pair) continue
    const partner = diffs.find((b) => b.kind === 'false' && !b.pair && b.letters >= 4
      && Math.abs(blocks[b.run[0]].startFrame - blocks[a.run[0]].startFrame) / sampleRate <= 20 && similarity(strip(text(a.run)), strip(text(b.run))) >= 0.5)
    if (partner) { a.pair = partner; partner.pair = a }
  }
  const result = {
    wholeMiss: { count: 0, words: 0, seconds: 0, items: [] }, wholeFalse: { count: 0, words: 0, seconds: 0, items: [] },
    wrongTake: { count: 0, items: [] }, seamShift: { count: 0, words: [], ms: [], items: [] }, fillerMiss: 0, fillerFalse: 0, fillerItems: [],
    review: { count: reviews.length, hit: 0 }, uncovered: 0,
  }
  const index = new Map(blocks.map((block, i) => [block.id, i]))
  const listed = new Uint8Array(count)
  for (const ids of reviews) for (const id of ids) listed[index.get(id)] = 1
  // 清单外的漏删：整处漏删或留错遍里，没有被任何待确认线索碰到的——用户只能自己听出来
  const unlisted = (run) => !listed.subarray(run[0], run[1]).some(Boolean)
  for (const diff of diffs) {
    const size = diff.run[1] - diff.run[0]
    if (diff.filler) { if (diff.kind === 'miss') result.fillerMiss++; else result.fillerFalse++; result.fillerItems.push(`${diff.kind === 'miss' ? '少删' : '多删'} ${describe(diff.run)}`); continue }
    if (diff.pair) { if (diff.kind === 'miss') { result.wrongTake.count++; if (unlisted(diff.run) && unlisted(diff.pair.run)) result.uncovered++; result.wrongTake.items.push(`${describe(diff.run)} ⇄ 【${text(diff.pair.run)}】`) } continue }
    if (diff.atSeam && size <= 3) {
      result.seamShift.count++; result.seamShift.words.push(size); result.seamShift.ms.push(Math.round(seconds(diff.run) * 1000))
      result.seamShift.items.push(`${diff.kind === 'miss' ? '少删' : '多删'} ${describe(diff.run)}`)
      continue
    }
    const bucket = diff.kind === 'miss' ? result.wholeMiss : result.wholeFalse
    if (diff.kind === 'miss' && unlisted(diff.run)) result.uncovered++
    bucket.count++; bucket.words += size; bucket.seconds += seconds(diff.run); bucket.items.push(`${diff.kind === 'miss' && unlisted(diff.run) ? '（清单外）' : ''}${describe(diff.run)}`)
  }
  // 命中：这条线索要删的词，定稿里过半确实删了
  result.review.items = []
  for (const ids of reviews) {
    if (!ids.length) continue
    const hit = ids.filter((id) => finalDeleted[index.get(id)]).length * 2 > ids.length
    if (hit) result.review.hit++
    result.review.items.push(`${hit ? '定稿删了' : '定稿留着'} ${describe([index.get(ids[0]), index.get(ids.at(-1)) + 1])}`)
  }
  return result
}

/**
 * 理想裁决：假设助手（或人）对每条线索都按定稿选了最接近的那种做法，之后还剩什么。
 * 这是“本地粗剪 + 二次判断”能到的上限：剩下的是线索里根本没有给出对应做法的，助手只能靠自己通读发现。
 * pendingOnly 只裁决待确认的线索；否则连已经自动删掉的也允许改判（改留前一遍、都留着）。
 * 定稿的做法与现在的做法删完读起来一字不差（两遍字面相同、只差是哪一遍的声音）时，看文字分不出来，不算助手能判对：
 * 不改判，只计数（audioOnly）。
 */
function idealDeleted(blocks, finalDeleted, algoDeleted, retakes, pendingOnly, tally = { audioOnly: 0 }) {
  const index = new Map(blocks.map((block, i) => [block.id, i]))
  const deleted = [...algoDeleted]
  for (const retake of retakes) {
    if (pendingOnly && !retake.review) continue
    const options = retake.options.length ? retake.options : retake.review ? [{ id: 'keep_later', blockIds: retake.blockIds }, { id: 'keep_both', blockIds: [] }] : []
    if (!options.length) continue
    const current = retake.review ? 'keep_both' : options[0].id
    const involved = [...new Set([...retake.blockIds, ...options.flatMap((option) => option.blockIds)])].map((id) => index.get(id)).filter((i) => i !== undefined && !isFillerWord(blocks[i].text))
    // 这条线索自己删掉的词改判时会恢复；别的线索、别的步骤删掉的词不归它管，哪种做法下都还是删着的
    const own = new Set(retake.review ? [] : retake.blockIds.map((id) => index.get(id)))
    let best, bestCost = Infinity
    for (const option of options) {
      const chosen = new Set(option.blockIds.map((id) => index.get(id)))
      const cost = involved.filter((i) => (chosen.has(i) || (deleted[i] && !own.has(i))) !== Boolean(finalDeleted[i])).length - (option.id === current ? 0.5 : 0)
      if (cost < bestCost) { best = option; bestCost = cost }
    }
    if (best.id === current) continue
    const ordered = [...involved].sort((a, b) => a - b)
    const readsAs = (option) => { const chosen = new Set(option.blockIds.map((id) => index.get(id))); return ordered.filter((i) => !(chosen.has(i) || (deleted[i] && !own.has(i)))).map((i) => strip(blocks[i].text)).join('') }
    if (readsAs(best) === readsAs(options.find((option) => option.id === current))) { tally.audioOnly++; continue }
    for (const i of own) deleted[i] = false
    for (const id of best.blockIds) deleted[index.get(id)] = true
  }
  return deleted
}

/** 把词的删除与剪切铺到 10 毫秒一格上。 */
function cells(fixture, deleted, cuts) {
  const total = Math.ceil(fixture.durationFrames / fixture.sampleRate * 100)
  const cell = (frame) => Math.round(frame / fixture.sampleRate * 100)
  const removed = new Uint8Array(total), muted = new Uint8Array(total)
  fixture.blocks.forEach((block, i) => { if (deleted[i]) removed.fill(1, cell(block.startFrame), Math.min(total, cell(block.endFrame))) })
  for (const cut of cuts) (cut.mute ? muted : removed).fill(1, cell(cut.startFrame), Math.min(total, cell(cut.endFrame)))
  return { removed, muted, total }
}

/**
 * 时间层面的比较（需要逐帧电平）：
 * - 停顿偏差：相邻两个保留词中点之间，成片里听到的非语音时长，与定稿之差；
 * - 硬接缝：拼接点两侧 20 毫秒都落在语音上；
 * - 碎保留段：不超过 120 毫秒、不含任何保留词主体、听得见的保留段；
 * - 切到字：保留词里有 30 毫秒以上的有声部分被删或静音（只数定稿没有这样处理的）；
 * - 边缘过切 / 欠切：相邻两个保留词中点之间，成片消掉（删或静音）而定稿让它出声的部分达到 30 毫秒算一处过切，反过来算欠切；
 *   “有声”只数其中电平够得上语音的部分。过切是用户要把边缘往里收的地方，欠切是用户要再补一刀的地方。
 *   与停顿偏差互补：停顿偏差只看听到多少安静，这两项看消掉的是不是同一段声音。
 */
function scoreTiming(fixture, levels, algo, final) {
  const { sampleRate, blocks } = fixture
  const a = cells(fixture, algo.deleted, algo.cuts), f = cells(fixture, final.deleted, final.cuts)
  const wide = levels.wideDb
  const speech = quantile(wide.filter((db) => db > -120), 0.8)
  const loud = (c) => wide[c] >= speech - 16
  const cell = (frame) => Math.round(frame / sampleRate * 100)
  const outSeconds = (state) => (state.total - state.removed.reduce((sum, value) => sum + value, 0)) / 100
  // 只有标点、没有字的词块（识别把“：”“”，”单独切出来）不是字：停顿与边缘都按它前后两个真正的字来量
  const both = blocks.map((block, i) => ({ block, i })).filter(({ block, i }) => !algo.deleted[i] && !final.deleted[i] && strip(block.text))
  const pauseDiffs = []
  for (let k = 0; k + 1 < both.length; k++) {
    const p = both[k].block, n = both[k + 1].block
    const from = cell((p.startFrame + p.endFrame) / 2), to = cell((n.startFrame + n.endFrame) / 2)
    const heard = (state) => { let quiet = 0; for (let c = from; c < to; c++) if (!state.removed[c] && (state.muted[c] || !loud(c))) quiet++; return quiet * 10 }
    pauseDiffs.push(heard(a) - heard(f))
  }
  const absolute = pauseDiffs.map(Math.abs)
  const silenced = (state, c) => state.removed[c] || state.muted[c]
  const edges = { over: 0, overLoud: 0, under: 0, underLoud: 0, overMs: [], underMs: [], items: [] }
  for (let k = 0; k + 1 < both.length; k++) {
    const p = both[k].block, n = both[k + 1].block
    // 两个词之间夹着“一边删、一边留”的词时，差的是整个词，已经记在整处漏删、误删、接缝偏移或语气词里，这里不再算一遍
    let wordDiffers = false
    for (let i = both[k].i + 1; i < both[k + 1].i; i++) if (strip(blocks[i].text) && Boolean(algo.deleted[i]) !== Boolean(final.deleted[i])) wordDiffers = true
    if (wordDiffers) continue
    const from = cell((p.startFrame + p.endFrame) / 2), to = cell((n.startFrame + n.endFrame) / 2)
    let over = 0, overLoud = 0, under = 0, underLoud = 0
    for (let c = from; c < to; c++) {
      if (silenced(a, c) && !silenced(f, c)) { over++; if (loud(c)) overLoud++ }
      if (!silenced(a, c) && silenced(f, c)) { under++; if (loud(c)) underLoud++ }
    }
    const at = p.endFrame / sampleRate, where = `${Math.floor(at / 60)}:${(at % 60).toFixed(2).padStart(5, '0')} ${p.text}｜${n.text}`
    if (over >= 3) { edges.over++; edges.overMs.push(over * 10); edges.items.push(`过切 ${over * 10} 毫秒（有声 ${overLoud * 10}） ${where}`) }
    if (overLoud >= 3) edges.overLoud++
    if (under >= 3) { edges.under++; edges.underMs.push(under * 10); edges.items.push(`欠切 ${under * 10} 毫秒（有声 ${underLoud * 10}） ${where}`) }
    if (underLoud >= 3) edges.underLoud++
  }
  const seams = (state) => {
    let hard = 0, total = 0
    for (let c = 2; c < state.total; c++) {
      if (!state.removed[c] || state.removed[c - 1]) continue
      let end = c
      while (end < state.total && state.removed[end]) end++
      if (end + 1 >= state.total) break
      total++
      const left = !state.muted[c - 1] && (loud(c - 1) || loud(c - 2)), right = !state.muted[end] && (loud(end) || loud(end + 1))
      if (left && right) hard++
    }
    return { hard, total }
  }
  const wordAt = new Int32Array(a.total).fill(-1)
  blocks.forEach((block, i) => wordAt.fill(i, cell(block.startFrame), Math.min(a.total, cell(block.endFrame))))
  const islands = (state, deleted) => runsOf(state.total, (c) => !state.removed[c] && !state.muted[c]).filter(([start, end]) => {
    if (end - start > 12 || start === 0 || end === state.total) return false
    let audible = false
    const words = new Set()
    for (let c = start; c < end; c++) { if (loud(c)) audible = true; if (wordAt[c] >= 0 && !deleted[wordAt[c]]) words.add(wordAt[c]) }
    if (!audible) return false
    return ![...words].some((w) => (Math.min(end, cell(blocks[w].endFrame)) - Math.max(start, cell(blocks[w].startFrame))) * 2 > cell(blocks[w].endFrame) - cell(blocks[w].startFrame))
  }).length
  const clipped = (state) => new Set(both.filter(({ block }) => {
    let count = 0
    for (let c = cell(block.startFrame); c < cell(block.endFrame); c++) if ((state.removed[c] || state.muted[c]) && loud(c)) count++
    return count >= 3
  }).map(({ i }) => i))
  const clippedFinal = clipped(f)
  return {
    outputSeconds: outSeconds(a), finalSeconds: outSeconds(f),
    pauses: { compared: pauseDiffs.length, over80: absolute.filter((ms) => ms > 80).length, over150: absolute.filter((ms) => ms > 150).length,
      longer80: pauseDiffs.filter((ms) => ms > 80).length, shorter80: pauseDiffs.filter((ms) => ms < -80).length, p90: quantile(absolute, 0.9), p99: quantile(absolute, 0.99) },
    hardSeams: seams(a).hard, seamCount: seams(a).total, finalHardSeams: seams(f).hard,
    islands: islands(a, algo.deleted), finalIslands: islands(f, final.deleted),
    clippedWords: [...clipped(a)].filter((i) => !clippedFinal.has(i)).length,
    edges: { over: edges.over, overLoud: edges.overLoud, under: edges.under, underLoud: edges.underLoud, overMedianMs: quantile(edges.overMs, 0.5), underMedianMs: quantile(edges.underMs, 0.5), items: edges.items },
  }
}

module.exports = { scoreWords, scoreTiming, idealDeleted, strip, isFillerWord, quantile }
