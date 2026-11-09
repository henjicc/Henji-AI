/**
 * 智能提示词优化的第一步：判断这次该按哪份写作指南优化。
 *
 * 指南就是助手技能 prompt-optimization 的 references 文件，生成页优化与助手写提示词共用同一份内容。
 * 能从目标模型类型、功能标签和素材数量唯一确定基础模式时直接选定，不花一次模型调用；
 * 确定不了（例如带图的图片任务可能是参考生图也可能是编辑）才交给模型在候选里挑。
 */

export const PROMPT_GUIDE_SKILL_NAME = 'prompt-optimization'

export type PromptGuideId =
  | 'image' | 'image-reference' | 'image-edit' | 'image-location' | 'character-sheet' | 'product' | 'poster'
  | 'video' | 'video-frames' | 'video-reference' | 'video-storyboard' | 'video-edit' | 'video-extension'
  | 'video-continuity' | 'video-sound'

export const PROMPT_GUIDE_TITLES: Record<PromptGuideId, string> = {
  image: '文生图：只有文字，从零出图',
  'image-reference': '参考生图：参考图提供人物、服装、风格等，生成新画面',
  'image-edit': '图片编辑：在原图上增删改，其余保持',
  'image-location': '编辑位置靠图上的标记、框选或坐标指定',
  'character-sheet': '三视图、角色设定、一次出一组图',
  product: '商品图、材质、电商展示',
  poster: '画面里要有标题、文案的海报',
  video: '文生视频：只有文字',
  'video-frames': '首帧生视频、首尾帧生视频',
  'video-reference': '参考生视频：图片、视频、音频分别提供外观、动作、运镜、音色',
  'video-storyboard': '多张关键帧或一张分镜宫格图生成视频',
  'video-edit': '修改已有视频的画面或声音',
  'video-extension': '延长已有视频、连接两段视频',
  'video-continuity': '多镜头要保持人物、道具、方向一致',
  'video-sound': '对白、音效、配乐、字幕或画面文字',
}

/** 叠加在基础模式之上的专项指南：只在模型判断需要时加读 */
const IMAGE_EXTRA_GUIDES: PromptGuideId[] = ['poster', 'product', 'character-sheet', 'image-location']
const VIDEO_EXTRA_GUIDES: PromptGuideId[] = ['video-sound', 'video-continuity']

export function promptGuidePath(id: PromptGuideId): string {
  return `references/${id}.md`
}

export interface PromptGuideRoutingInput {
  modelType?: string
  /** 目标模型的功能标签（text-to-image、image-to-image、reference-mode 等） */
  modelTags?: readonly string[]
  imageCount: number
  videoCount: number
  audioCount?: number
}

export interface PromptGuideCandidates {
  /** 可能的基础模式；只有一个时直接用 */
  base: PromptGuideId[]
  /** 可以叠加的专项指南 */
  extras: PromptGuideId[]
}

export function resolvePromptGuideCandidates(input: PromptGuideRoutingInput): PromptGuideCandidates {
  const tags = new Set(input.modelTags ?? [])
  const has = (tag: string): boolean => tags.has(tag)
  if (input.modelType === 'image') {
    if (input.imageCount === 0) return { base: ['image'], extras: IMAGE_EXTRA_GUIDES }
    // 不支持图生图的图片模型带图只能是处理原图（局部重绘、超分、重打光等），没有参考生图这条路
    return { base: has('image-to-image') ? ['image-reference', 'image-edit'] : ['image-edit'], extras: IMAGE_EXTRA_GUIDES }
  }
  if (input.modelType === 'video') {
    if (input.videoCount > 0) {
      const base = [
        has('reference-mode') ? 'video-reference' : null,
        has('video-to-video') ? 'video-edit' : null,
        has('video-extension') ? 'video-extension' : null,
      ].filter((id): id is PromptGuideId => id !== null)
      return { base: base.length > 0 ? base : ['video-reference', 'video-edit', 'video-extension'], extras: VIDEO_EXTRA_GUIDES }
    }
    if (input.imageCount > 0) {
      const base: PromptGuideId[] = []
      if (input.imageCount <= 2 && (has('image-to-video') || has('start-end-frame'))) base.push('video-frames')
      if (has('reference-mode') || input.imageCount > 2) base.push('video-reference', 'video-storyboard')
      return { base: base.length > 0 ? base : ['video-frames'], extras: VIDEO_EXTRA_GUIDES }
    }
    if ((input.audioCount ?? 0) > 0) return { base: ['video-reference'], extras: VIDEO_EXTRA_GUIDES }
    return { base: ['video'], extras: VIDEO_EXTRA_GUIDES }
  }
  // 音频等没有对应指南的类型只用通用写法
  return { base: [], extras: [] }
}

/** 第一步的选择题：候选只有一个且不涉及专项时不必问模型 */
export function needsPromptGuideRouting(candidates: PromptGuideCandidates, prompt: string): boolean {
  if (candidates.base.length > 1) return true
  if (candidates.extras.length === 0) return false
  // 专项指南靠这些线索触发：引号里的文字、商品、组图、对白配乐等；没有线索就不多花一次调用
  return /[“"「『]|文字|标题|文案|海报|字幕|logo|商品|产品|电商|三视图|组图|角色设定|标记|圈出|坐标|对白|台词|配音|音效|配乐|音乐|bgm|多镜头|镜头\s*[2二]|分镜/i.test(prompt)
}

export function buildPromptGuideRoutingMessages(
  candidates: PromptGuideCandidates,
  context: { prompt: string; modelName?: string; modelType?: string; mediaSummary: string },
): { system: string; user: string } {
  const list = (ids: PromptGuideId[]): string => ids.map((id) => `- ${id}：${PROMPT_GUIDE_TITLES[id]}`).join('\n')
  return {
    system: [
      '你在为一次图片或视频生成选择提示词写作指南。只输出 JSON：{"guides":["…"]}，不要解释。',
      `从基础模式里恰好选一个放在第一位：\n${list(candidates.base)}`,
      candidates.extras.length > 0
        ? `再按需要追加 0–2 个专项指南，用户的提示词确实涉及时才加：\n${list(candidates.extras)}`
        : '',
    ].filter(Boolean).join('\n\n'),
    user: [
      `目标模型：${context.modelName ?? '未知'}（${context.modelType ?? '未知类型'}）`,
      `参考素材：${context.mediaSummary}`,
      `用户提示词：\n${context.prompt}`,
    ].join('\n'),
  }
}

/** 解析模型的选择；读不出或越出候选时回退到第一个基础模式，保证总能继续优化 */
export function parsePromptGuideRoutingAnswer(answer: string, candidates: PromptGuideCandidates): PromptGuideId[] {
  const fallback = candidates.base.slice(0, 1)
  const match = answer.match(/\{[\s\S]*\}/)
  let picked: unknown
  try {
    picked = match ? (JSON.parse(match[0]) as { guides?: unknown }).guides : undefined
  } catch {
    return fallback
  }
  if (!Array.isArray(picked)) return fallback
  const ids = picked.filter((id): id is PromptGuideId => typeof id === 'string')
  const base = ids.find((id) => candidates.base.includes(id)) ?? fallback[0]
  const extras = ids.filter((id) => candidates.extras.includes(id)).slice(0, 2)
  return [base, ...extras].filter((id): id is PromptGuideId => Boolean(id))
}

/** 技能主文件里给所有模式用的通用写法一节；助手专用的加载说明与执行边界不进优化请求 */
export function extractCommonPromptRules(skillMain: string): string {
  const start = skillMain.indexOf('## 所有模式通用的写法')
  if (start < 0) return ''
  const end = skillMain.indexOf('\n## ', start + 1)
  return skillMain.slice(start, end < 0 ? undefined : end).trim()
}

/** 智能优化的用户消息：目标模型与素材情况在前，原始想法在后 */
export const SMART_PROMPT_USER_TEMPLATE = [
  '当前目标模型：{{target.model.name}}；类型：{{target.model.type}}；功能：{{target.model.functions}}；模型描述：{{target.model.description}}。',
  '当前参考素材：{{media.summary}}。请把下面的原始想法优化为可直接提交给该模型的最终提示词：',
  '',
  '{{prompt}}',
].join('\n')

export function buildSmartOptimizationSystemPrompt(commonRules: string, guides: readonly string[]): string {
  return [
    '你是图片与视频生成的提示词优化器。按下面的写作规则，把用户的原始想法改写成可直接提交给目标模型的最终提示词。',
    '保留用户已经明确的主体、数量、动作、台词、文字、风格、素材编号（@图片1、@视频1 等）和修改范围，不擅自改变原意；输入很短时补足关键的可见、可听细节，不向用户提问。',
    '只输出最终提示词本身：不要解释、标题、Markdown、引号、前后缀或多个方案；使用与用户输入相同的语言，目标模型只认英文时用英文。',
    commonRules,
    ...guides,
  ].filter((part) => part.trim()).join('\n\n')
}
