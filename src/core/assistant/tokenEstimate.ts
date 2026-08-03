/**
 * Agent 运行时的文本 token 估算，**唯一来源**。
 *
 * 此前有两份：压缩链路按字符类别加权，分层预算却是统一 `length / 4`。两者在同一个
 * `AgentContextBuilder` 里被同时调用——分层按 `/4` 把层塞满，构建器再用加权口径一量发现
 * 超了，就掉头去砍活动工具（`while (estimatedTokens > threshold) activeTools.pop()`）。
 * 也就是说**中文越多，工具被砍得越狠**，而现象看起来像"工具位莫名其妙不够用"，跟中文毫无
 * 关联线索。
 *
 * `/4` 是英文经验值。中文基本一字一 token，用 `/4` 会低估三到四倍：一个标称 700 token 的
 * 层实际能塞进约 2,800 个中文字符。低估的代价不是省钱，是预算失真——该压缩时不压缩，
 * 该保留的层反而被挤掉。
 */

/** 中文/日文/韩文字符：基本一字一 token。 */
function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x30ff) // 平假名、片假名
    || (code >= 0x3130 && code <= 0x318f) // 谚文兼容字母
    || (code >= 0x3400 && code <= 0x4dbf) // CJK 扩展 A
    || (code >= 0x4e00 && code <= 0x9fff) // CJK 统一表意文字
    || (code >= 0xac00 && code <= 0xd7af) // 谚文音节
    || (code >= 0xf900 && code <= 0xfaff) // CJK 兼容表意文字
    || code >= 0x20000 // CJK 扩展 B 及以后
  )
}

/** 英文单词与数字：约三字符一 token。 */
function isWordCodePoint(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || (code >= 0x30 && code <= 0x39)
    || code === 0x5f
  )
}

/** 与正则 `\s` 等价的空白判断；这里不写正则，避免转义在格式化时被破坏。 */
function isWhitespaceCodePoint(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d)
    || code === 0x20
    || code === 0xa0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0x3000
    || code === 0xfeff
  )
}

/**
 * 按字符类别加权估算 token 数。
 *
 * 三档：CJK 一字一 token；英数约 3 字符一 token；其余非空白字符（JSON 标点、全角符号等）
 * 约 2 字符一 token。空白不计。宁可高估，不可低估——低估会让预算失真到看不出来。
 */
export function estimateAgentTextTokens(text: string): number {
  let cjk = 0
  let word = 0
  let structural = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (isCjkCodePoint(code)) cjk += 1
    else if (isWordCodePoint(code)) word += 1
    else if (!isWhitespaceCodePoint(code)) structural += 1
  }
  return cjk + Math.ceil(word / 3) + Math.ceil(structural / 2)
}

/**
 * 把文本截断到 token 预算内，返回是否发生了截断。
 *
 * 必须按同一套加权口径扫描，不能用「预算 × 4」换算字符数——那正是低估的来源，中文下会
 * 放行四倍于预算的内容。
 */
export function truncateToAgentTokenBudget(
  text: string,
  maxTokens: number
): { text: string; truncated: boolean } {
  if (estimateAgentTextTokens(text) <= maxTokens) return { text, truncated: false }
  let used = 0
  let end = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    // 单字成本与 estimateAgentTextTokens 的三档权重一一对应
    const cost = isCjkCodePoint(code) ? 1
      : isWhitespaceCodePoint(code) ? 0
        : isWordCodePoint(code) ? 1 / 3 : 1 / 2
    if (used + cost > maxTokens) break
    used += cost
    end += character.length
  }
  return { text: text.slice(0, end), truncated: true }
}
