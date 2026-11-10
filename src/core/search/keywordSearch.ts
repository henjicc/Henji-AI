/**
 * 本地关键词检索（BM25）：给记忆召回、按名称查找这类“几百到几千条短文本”的场景用，毫秒级、不联网、不依赖模型。
 *
 * 中文没有空格分词，按单字加相邻两字切词：“字体”“动效”这类两字词能直接命中，
 * 不像 SQLite FTS5 trigram 至少要三个字。拉丁字母与数字按整词切，统一小写。
 * 选它而不是 MiniSearch 等库：难点只在中文切词，打分本身只有几行；条目量小，不需要持久索引。
 */
const CJK = /[㐀-鿿豈-﫿]/
const WORD = /[a-z0-9]+(?:[._-][a-z0-9]+)*/g

function keywordTokens(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens = [...lower.matchAll(WORD)].map(match => match[0])
  const runs = lower.split(/[^㐀-鿿豈-﫿]+/).filter(run => run && CJK.test(run))
  for (const run of runs) {
    const chars = [...run]
    // 单字也收进来，单字查询（“红”“宋”）才能命中；两字词文档频率更低，打分里自然占优
    tokens.push(...chars)
    for (let index = 0; index + 1 < chars.length; index += 1) tokens.push(chars[index] + chars[index + 1])
  }
  return tokens
}

export interface KeywordMatch { index: number; score: number }

/** 按与查询的相关度给文本排序，只返回得分大于 0 的；查询切不出词时返回空。 */
export function rankByKeywords(texts: readonly string[], query: string, limit = texts.length): KeywordMatch[] {
  const queryTokens = [...new Set(keywordTokens(query))]
  if (!queryTokens.length || !texts.length) return []
  const documents = texts.map(text => keywordTokens(text))
  const averageLength = documents.reduce((sum, tokens) => sum + tokens.length, 0) / documents.length || 1
  const frequency = new Map<string, number>()
  for (const tokens of documents) for (const token of new Set(tokens)) frequency.set(token, (frequency.get(token) ?? 0) + 1)
  const k1 = 1.2, b = 0.75
  return documents.map((tokens, index) => {
    let score = 0
    for (const token of queryTokens) {
      const occurrences = tokens.reduce((count, value) => count + (value === token ? 1 : 0), 0)
      if (!occurrences) continue
      const containing = frequency.get(token) ?? 0
      const idf = Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5))
      score += idf * occurrences * (k1 + 1) / (occurrences + k1 * (1 - b + b * tokens.length / averageLength))
    }
    return { index, score }
  }).filter(match => match.score > 0).sort((a, b2) => b2.score - a.score || a.index - b2.index).slice(0, limit)
}

/** 两段文本切词后的重合度（Jaccard，0–1），用来发现几乎重复的短句。 */
export function keywordOverlap(a: string, b: string): number {
  // 单字会让只差一两个字的不同句子显得相近，重合度只看词（两字词与拉丁整词）
  const words = (text: string): Set<string> => new Set(keywordTokens(text).filter(token => token.length > 1 || !CJK.test(token)))
  const left = words(a), right = words(b)
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared)
}
