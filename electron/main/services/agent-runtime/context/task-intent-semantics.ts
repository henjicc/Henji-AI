/*
 * 目标文本里的**动作极性**判断：某个动作词到底是被要求执行，还是出现在"不要删除"这类约束里。
 *
 * 这个文件曾经还负责 inferIntentTaskSemantics——把一句话推成 capabilityKinds + effect +
 * entityTypes，喂给任务图当"本轮必须产生哪些 Effect"。那是运行前的猜测，猜错就永远结算不了；
 * 任务图删除后它一并删掉。留下的两个函数只服务路由分类：判错的代价是候选能力排序偏一点。
 */
const NEGATED_ACTION_PREFIX = /(?:不要|别|不准|禁止|不得|无需|不用|不需要|避免|切勿|不可|绝不|不能|勿|do\s+not|don't|never|without|avoid|must\s+not|no\s+need\s+to)\s*(?:再|再次|重新|继续|去|进行|执行|把|将|to)?\s*$/i
const NEGATION_SCOPE = /(?:不要|别|不准|禁止|不得|无需|不用|不需要|避免|切勿|不可|绝不|不能|勿|do\s+not|don't|never|without|avoid|must\s+not|no\s+need\s+to)/gi
const NEGATION_SCOPE_RESET = /(?:但(?:是)?|不过|而是|然后|随后|接着|之后|再(?:去|来|执行|进行)?|but|however|instead|then)/gi

function lastMatchEnd(value: string, pattern: RegExp): number {
  let end = -1
  for (const match of value.matchAll(pattern)) end = (match.index ?? 0) + match[0].length
  return end
}

function isInsideNegatedActionScope(prefix: string): boolean {
  if (NEGATED_ACTION_PREFIX.test(prefix.slice(-40))) return true
  // 协调否定必须覆盖“不要切换或打开”“do not open or navigate”中的第二个及后续动作。
  // 标点已在调用方切成分句；转折/时序词会显式结束否定作用域。
  return lastMatchEnd(prefix, NEGATION_SCOPE) > lastMatchEnd(prefix, NEGATION_SCOPE_RESET)
}

/**
 * 判断动作词是否真的被用户要求执行，而不是出现在“不要删除”“without creating”一类约束中。
 * 只看动作前同一分句的短窗口，避免一个分句里的否定错误吞掉后续明确动作；同时允许一句话中
 * 既有被否定动作又有肯定动作，肯定命中仍然成立。
 */
export function hasAffirmativeIntent(goal: string, pattern: RegExp): boolean {
  const normalized = goal.normalize('NFKC')
  const flags = [...new Set(`${pattern.flags.replace('y', '')}g`)].join('')
  // 动作与宾语也必须位于同一分句；否则“重命名图片，……不要删除素材”这类文本可能从前一个
  // “图片”一路跨标点匹配到后一个“删除”，绕过删除词前的否定判断。
  for (const clause of normalized.split(/[，。；;,.!?！？\n]/)) {
    const matcher = new RegExp(pattern.source, flags)
    for (const match of clause.matchAll(matcher)) {
      const start = match.index ?? 0
      const clausePrefix = clause.slice(0, start)
      if (!isInsideNegatedActionScope(clausePrefix)) return true
    }
  }
  return false
}

export function asksToGenerateMedia(goal: string): boolean {
  // “已有生成结果作为图片节点”里的「生成」是结果类型，不是生成动作。中文动作不得紧跟
  // 结果/记录/历史/任务/的；英文使用词边界，避免把 generated / generation 当成 generate。
  // 否则路由会凭空创建一个必须执行的新生成 Facet，与“不要重新生成”形成永不收敛的任务图。
  const generationAction = /(?:生成(?!结果|记录|历史|任务|的)|制作|创作|绘制|画(?!布|面)|\bcreate\b|\bgenerate\b)/i
  const explicitMedia = /(?:图片|图像|照片|海报|插画|壁纸|封面|头像|视频|音频|音乐|语音|image|poster|illustration|wallpaper|cover|avatar|video|audio)/i
  // “生成一张赛博朋克海报”并不一定再写“图片”二字，但“张”已经是明确的图像量词。
  // 量词与动作必须留在同一分句，并继续经过否定极性判断，不能把“不要生成一张图”算成任务。
  const implicitImageClassifier = /(?:生成(?!结果|记录|历史|任务|的)|制作|创作|绘制|画(?!布|面)|\bcreate\b|\bgenerate\b)\s*(?:一|1|两|2|三|3|几)?\s*(?:张|幅)\s*[^，。；;,.!?！？\n]{0,48}/i
  return goal.normalize('NFKC').split(/[，。；;,.!?！？\n]/).some((clause) => (
    hasAffirmativeIntent(clause, generationAction)
    && (explicitMedia.test(clause) || hasAffirmativeIntent(clause, implicitImageClassifier))
  ))
    && !/(?:取消|停止|终止|cancel|stop).{0,24}(?:生成|任务|task)/i.test(goal)
    && !/^(?:查看|查询|检查|确认).{0,24}(?:生成历史|历史记录|状态|进度)/i.test(goal.trim())
}
