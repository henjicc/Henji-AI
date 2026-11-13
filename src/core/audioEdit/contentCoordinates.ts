/*
 * 内容坐标：把念出来的字（无声调拼音）对到参考稿上，得到每个字念的是稿子的第几个字。
 * 照稿念时人是顺着稿子往下走的，念坏了就往回跳一段重新念——所以除了“对上、错字、多念、漏念”，对齐还允许“往回跳”：
 * 每一次回跳就是一次重念的起点，回跳前没对上稿子的那几个字是念坏的尾巴（或临场加的话）。
 * 不看标点、不看停顿；识别错几个字只是多几处“错字”，不影响回跳的位置。
 */

export interface ContentCoordinates {
  /** 每个字对到稿子的位置；-1 表示没对上（临场加的话、念坏的尾巴） */
  position: Int32Array
  /** 这个字之前往回跳了（重念从这里开始） */
  jumpBefore: Uint8Array
}

const MATCH = 1
const MISMATCH = -1
/** 念了稿子里没有的字 */
const EXTRA = -0.5
/** 稿子里的字没念 */
const SKIPPED = -0.7
/** 往回跳一次：比它便宜的重合（两三个字碰巧相同）不值得解释成重念 */
const JUMP = -3
/** 一次最多往回跳多少个字（约一分钟的稿子） */
const MAX_JUMP = 400
/** 长录音分块对齐：每块的字数、每块确定下来的字数、稿子窗口在预计位置前后多看的字数、每块往前多带的上文字数 */
const BLOCK = 1500
const COMMIT = 1000
const MARGIN = 500
const OVERLAP = 200
/** 连着这么多个字对不上稿子，就从这里按整份稿子重新找位置 */
const LOST_RUN = 60
/** 重新找位置：对角线按这么多字归成一档，至少要有这么多处连着三个字相同 */
const ANCHOR_BUCKET = 50
const ANCHOR_MIN_VOTES = 8

/** 一块念出来的字对到稿子的一个窗口上（窗口内任意处起、任意处止）。返回各字在窗口里的位置与回跳标记。 */
function alignBlock(spoken: readonly string[], script: readonly string[], jumpCost: (index: number) => number): ContentCoordinates {
  const n = spoken.length, m = script.length, width = m + 1
  const score = new Float32Array((n + 1) * width)
  const move = new Uint8Array((n + 1) * width) // 1 对上或错字 2 多念 3 漏念 4 回跳后对上
  const from = new Int32Array((n + 1) * width)
  const best = new Float32Array(width), bestAt = new Int32Array(width), queue = new Int32Array(width)
  for (let i = 1; i <= n; i++) {
    const row = i * width, previous = row - width
    const unit = spoken[i - 1], cost = jumpCost(i - 1)
    // 上一行在 (j, j + MAX_JUMP] 里的最大值：从右往左的单调队列；这个字之前不能回跳时不用算
    let head = 0, tail = 0
    for (let j = cost === Infinity ? -1 : m; j >= 0; j--) {
      if (j + 1 <= m) {
        while (tail > head && score[previous + queue[tail - 1]] <= score[previous + j + 1]) tail--
        queue[tail++] = j + 1
      }
      while (tail > head && queue[head] > j + MAX_JUMP) head++
      if (tail > head) { best[j] = score[previous + queue[head]]; bestAt[j] = queue[head] } else best[j] = -Infinity
    }
    for (let j = 0; j <= m; j++) {
      let value = score[previous + j] + EXTRA, step = 2
      if (j > 0) {
        const same = unit === script[j - 1]
        const diagonal = score[previous + j - 1] + (same ? MATCH : MISMATCH)
        if (diagonal > value) { value = diagonal; step = 1 }
        if (same && cost !== Infinity) {
          const jumped = best[j - 1] + JUMP - cost + MATCH
          if (jumped > value) { value = jumped; step = 4; from[row + j] = bestAt[j - 1] }
        }
      }
      score[row + j] = value; move[row + j] = step
    }
    for (let j = 1; j <= m; j++) {
      const skipped = score[row + j - 1] + SKIPPED
      if (skipped > score[row + j]) { score[row + j] = skipped; move[row + j] = 3 }
    }
  }
  let j = 0
  for (let k = 1; k <= m; k++) if (score[n * width + k] > score[n * width + j]) j = k
  const position = new Int32Array(n).fill(-1), jumpBefore = new Uint8Array(n)
  for (let i = n; i > 0;) {
    const step = move[i * width + j]
    if (step === 1) { position[i - 1] = spoken[i - 1] === script[j - 1] ? j - 1 : -1; i--; j-- }
    else if (step === 4) { position[i - 1] = j - 1; jumpBefore[i - 1] = 1; const back = from[i * width + j]; i--; j = back }
    else if (step === 2) i--
    else if (step === 3) j--
    else break
  }
  return { position, jumpBefore }
}

/**
 * 这一截话最可能在稿子的哪里：数与稿子连着三个字相同的地方，看它们集中在哪条“对角线”上。
 * 返回这一截开头对应的稿子位置；对不上时返回 undefined。
 */
function locateInScript(spoken: readonly string[], script: readonly string[], index: Map<string, number[]>): number | undefined {
  const votes = new Map<number, number>()
  for (let i = 0; i + 2 < spoken.length; i++) {
    for (const j of index.get(`${spoken[i]} ${spoken[i + 1]} ${spoken[i + 2]}`) ?? []) {
      const bucket = Math.round((j - i) / ANCHOR_BUCKET)
      votes.set(bucket, (votes.get(bucket) ?? 0) + 1)
    }
  }
  let best: number | undefined, count = ANCHOR_MIN_VOTES - 1
  for (const [bucket, value] of votes) if (value > count) { best = bucket; count = value }
  return best === undefined ? undefined : Math.max(0, Math.min(script.length - 1, best * ANCHOR_BUCKET))
}

/**
 * 把念出来的字对到参考稿上。长录音分块做，每块只看稿子里预计位置附近的一段，内存与耗时都按录音长度线性增长。
 * - 每块往前多带 OVERLAP 个字的上文：重念正好从一块的开头起时，也看得到它是往回跳；
 * - 连着一长段对不上稿子（跳过了稿子一大段、回头重录、稿子只念了一部分）时，从那里按整份稿子重新找位置再对，不会从此一直对不上。
 * jumpCost 给出在第 index 个字之前回跳要多付的代价（人重念几乎总是停一下再起，不在停顿后的位置回跳要贵一些）。
 */
export function alignToScript(spoken: readonly string[], script: readonly string[], jumpCost: (index: number) => number = () => 0): ContentCoordinates {
  const position = new Int32Array(spoken.length).fill(-1), jumpBefore = new Uint8Array(spoken.length)
  if (!spoken.length || !script.length) return { position, jumpBefore }
  let index: Map<string, number[]> | undefined
  const trigrams = (): Map<string, number[]> => {
    if (!index) {
      index = new Map()
      for (let j = 0; j + 2 < script.length; j++) {
        const key = `${script[j]} ${script[j + 1]} ${script[j + 2]}`
        const list = index.get(key)
        if (list) list.push(j); else index.set(key, [j])
      }
    }
    return index
  }
  let reached = 0
  for (let start = 0; start < spoken.length;) {
    const from = Math.max(0, start - OVERLAP)
    const end = Math.min(spoken.length, from + BLOCK)
    let commitEnd = end >= spoken.length ? end : Math.min(end, start + COMMIT)
    const chunk = spoken.slice(from, end)
    const align = (center: number): { block: ContentCoordinates; low: number; matched: number } => {
      const low = Math.max(0, center - MARGIN), high = Math.min(script.length, center + chunk.length + MARGIN)
      const block = alignBlock(chunk, script.slice(low, high), (k) => jumpCost(from + k))
      let matched = 0
      for (let k = start - from; k < commitEnd - from; k++) if (block.position[k] >= 0) matched++
      return { block, low, matched }
    }
    let result = align(reached)
    // 这一块里第一段连着对不上稿子的话
    let lostFrom = -1
    for (let k = start, run = 0; k < commitEnd && lostFrom < 0; k++) { run = result.block.position[k - from] < 0 ? run + 1 : 0; if (run >= LOST_RUN) lostFrom = k - run + 1 }
    if (lostFrom === start) {
      const anchor = locateInScript(spoken.slice(start, Math.min(commitEnd, start + 4 * LOST_RUN)), script, trigrams())
      const retry = anchor === undefined ? undefined : align(anchor)
      if (retry && retry.matched > result.matched) result = retry
      // 这一小段是稿子里没有的话，找不到位置：只定下这一小段，下一块接着从后面找，不把整块都按“对不上”定下来
      else commitEnd = Math.min(commitEnd, start + 4 * LOST_RUN)
    } else if (lostFrom > start) commitEnd = lostFrom // 先定下对得上的部分，对不上的那段留到下一块、从它开头重新找位置
    let lastAligned = -1
    for (let k = start; k < commitEnd; k++) {
      const local = result.block.position[k - from]
      if (local >= 0) { position[k] = local + result.low; lastAligned = position[k] }
      jumpBefore[k] = result.block.jumpBefore[k - from]
    }
    // 下一块从这一块最后念到的稿子位置接着找（不取最大值：回头重录时要能跟着往回走）
    if (lastAligned >= 0) reached = lastAligned
    start = commitEnd
  }
  return { position, jumpBefore }
}
