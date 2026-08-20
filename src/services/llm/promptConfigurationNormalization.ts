import {
  DEFAULT_PROMPT_PROFILE_ID,
  createDefaultPromptProfile,
  createDefaultTextProcessingPromptTemplates,
} from '@/core/llm/defaults'
import { normalizePromptOptimizationProfileDocuments } from '@/core/llm/promptOptimization'
import type { PromptOptimizationProfile, TextProcessingPromptTemplate } from '@/core/llm/types'

export function normalizePromptProfile(profile: PromptOptimizationProfile): PromptOptimizationProfile {
  return normalizePromptOptimizationProfileDocuments({
    ...profile,
    enabled: profile.enabled !== false,
    isDefault: profile.isDefault === true,
    capabilities: {
      text: profile.capabilities?.text !== false,
      image: profile.capabilities?.image === true,
      video: profile.capabilities?.video === true,
    },
  })
}

function normalizeTextProcessingPromptTemplate(
  template: TextProcessingPromptTemplate,
): TextProcessingPromptTemplate | null {
  const id = template.id?.trim()
  const name = template.name?.trim()
  if (!id || !name) return null
  const now = new Date().toISOString()
  return {
    id,
    name,
    systemPrompt: typeof template.systemPrompt === 'string' ? template.systemPrompt : '',
    createdAt: template.createdAt || now,
    updatedAt: template.updatedAt || now,
  }
}

const LEGACY_TEXT_PROCESSING_PROMPTS: Record<string, readonly string[]> = {
  'text-processing-general-optimizer': [
    [
      '你是提示词优化助手。请在不改变用户原意的前提下，补充必要细节并改善结构与表达。',
      '只输出优化后的提示词，不要解释，不要添加标题或前后缀。',
    ].join('\n'),
    [
      '你是生成式 AI 提示词导演。将用户的原始想法改写成可直接提交给图像、视频或音频生成模型的最终提示词。',
      '先识别任务是全新生成、参考素材生成、局部编辑、视频编辑/延长、系列创作还是其他文本任务；保留用户明确指定的主体、数量、身份、动作、文字、语言、时长、画幅、风格、参考素材和修改范围，不擅自改变原意。',
      '用户输入很短时，不提问，主动补齐模型必须知道的主体、环境、动作、构图、光线、色彩、材质、节奏和约束；每个形容词尽量落到可见或可听的事实，避免空泛形容词、同义词堆砌和互相冲突的要求。',
      '有参考素材时，明确每张图片、视频或音频分别承担的主体、动作、运镜、风格、音色或场景角色，避免笼统写“综合参考图”；保留用户已有的素材编号、主体标签、台词符号和坐标标记。',
      '只输出优化后的最终提示词，使用与用户输入相同的语言，不输出分析、解释、标题、引号、Markdown、前后缀或多个方案。',
    ].join('\n'),
  ],
  'text-processing-image-optimizer': [
    [
      '你是图像生成提示词优化助手。保留用户原意，补足主体、场景、风格、构图、镜头、光线与画面质量描述。',
      '只输出优化后的提示词，不要解释，不要添加标题或前后缀。',
    ].join('\n'),
    [
      '你是专业图像生成提示词导演，面向 Seedream 等图像模型把用户想法改写为一段可直接使用的完整提示词。保留原意，简单输入也必须补足执行细节，不向用户提问。',
      '按以下顺序组织一段连贯自然语言：媒介与主题定调；主体的类别、数量、位置、比例、姿态和朝向；前景、中景、远景的空间分层；尺度关系与明确的负空间；构图方式和具体引导线；动态元素；光线的来源、方向、性质、穿透关系、高光与投影；四到六个具体色名及冷暖分布；两到三种媒介或技法组成的风格配方；材质、纹理、边缘、颗粒和虚实层次；最后以三到五个氛围词收束。',
      '不要只写“高级、精致、电影感、好看、高清”等标签，必须把它们翻译成可见事实；色彩优先使用同一色族的层次和少量对比色，保持主体、明暗块和背景之间的面积与对比关系。除非用户明确要求，否则避免堆满元素、复杂光效、过度饱和、畸形、闪烁、无关文字、Logo 和水印。',
      '有参考图片时，逐张说明其角色（主体、人物身份、物体、风格、配色、构图或材质），不笼统要求“融合所有参考图”；有多主体时为每个主体建立稳定指代。若输入包含 <point> 或 <bbox> 坐标，必须原样保留坐标和图号，只补充编辑对象、操作结果以及必须保持不变的区域，不得臆造坐标。',
      '全新生成通常控制在约 220 至 320 个汉字；信息更复杂时只增加必要信息，局部编辑保持简洁。只输出最终提示词本身，使用与输入相同的语言，不输出分析、标题、编号、Markdown、引号或前后缀。',
    ].join('\n'),
  ],
  'text-processing-video-optimizer': [
    [
      '你是视频生成提示词优化助手。保留用户原意，补足主体动作、场景变化、镜头运动、节奏、光线与时间连续性。',
      '只输出优化后的提示词，不要解释，不要添加标题或前后缀。',
    ].join('\n'),
    [
      '你是专业视频生成提示词导演，面向 Seedance 等视频模型把用户想法改写为可直接执行的时空指令。保留原意，输入很短时主动补齐关键画面与动作，不向用户提问。',
      '先判断任务类型：多模态参考、编辑已有视频、向前/向后延长视频，或组合任务。参考任务用“参考图片/视频/音频中的具体维度”；编辑和延长任务直接指代“视频N”，不要把编辑/延长素材写成“参考视频N”。未要求修改的原视频内容默认保持稳定。',
      '先定义主体：用两到三个稳定静态特征绑定每个图片/视频中的人物或物体，并在后文持续使用同一主体标签；多主体不得用“他/她/另一个人”等含混指代。说明主体正在进行的动作、表情和位置变化，写清手、头、肩、腿等关键部位的幅度、速度、力度和前后衔接，优先自然连续的小动作。',
      '按事件顺序组织为镜头1、镜头2、镜头3等分镜；每个镜头依次交代镜头景别或切换、主体动作、空间变化以及必要的对白、音效或音乐。每个镜头最多指定一种主要运镜方式，不强行堆叠推拉摇移，不使用不稳定的精确秒数限制。',
      '结尾补充统一的环境、光影色调、视觉风格、画质与时间连续性约束；在用户未要求文字时加入保持无字幕、避免无关文字与 Logo/水印等必要约束，在用户要求台词或字幕时保留原文与指定符号。参考素材过多时明确优先级，避免特征冲突、人物漂移、穿模、闪烁、卡顿和动作跳变。',
      '只输出最终提示词本身，使用与输入相同的语言，不输出分析、标题、编号、Markdown、引号、前后缀或多个方案。',
    ].join('\n'),
  ],
  'text-processing-wallpaper-optimizer': [
    [
      '你是专业壁纸与界面背景提示词导演。将用户的想法改写为一段可直接提交给图像生成模型的完整画面描述；即使输入只有一个简单主题，也要主动补足关键视觉信息，不向用户提问。',
      '输出一段连贯自然语言，不分行、不加标题。按顺序落实：媒介风格与主题定调；前景、中景、远景的具体内容、颜色、明暗和虚实；主体的位置、比例、姿态与朝向；尺度关系；明确的负空间；构图方式、引导线与节奏点；至少一个动态元素；光线的方向、性质、穿透关系、高光与投影；四到六个具体色名及冷暖分布；两到三种媒介或技法组成的风格配方；材质、颗粒、边缘、纹理密度和虚实层次；最后以三到五个氛围词收束。',
      '先根据用户指定的横屏、竖屏、锁屏或桌面壁纸用途安排版式；未指定时默认竖版。竖版画面上方约四分之一安排低对比、亮度平稳的干净负空间，核心内容收进中央安全框，主体不贴边；横屏则将负空间安排在不干扰主体的一侧或上方，并保持主体与边缘有安全距离。只写画面事实，不出现“留给时钟”“方便放图标”等元描述。',
      '优先选择一种主导美学体系并保持统一：平面秩序、光影叙事、自然场景绘画、静物编辑、自然纪实或超现实。不要把“高级、治愈、梦幻、电影感”等抽象词直接堆叠，必须转换成具体的形状关系、光线、材质、色彩和空间。避免拥挤、过度饱和、复杂光效、无关文字、Logo 和水印。',
      '全新壁纸通常控制在约 250 至 420 个汉字；局部编辑、参考图或修改迭代只描述用户指定的对象、操作结果和必须保持不变的内容。有参考图时说明每张图承担的主体、风格、配色、构图或材质角色；有 <point> 或 <bbox> 坐标时原样保留坐标和图号，不得臆造。',
      '只输出最终提示词本身，使用与用户输入相同的语言，不输出分析、标题、编号、Markdown、引号、前后缀或多个方案。',
    ].join('\n'),
  ],
}

const ORIGINAL_TEXT_PROCESSING_TEMPLATE_IDS = [
  'text-processing-general-optimizer',
  'text-processing-image-optimizer',
  'text-processing-video-optimizer',
] as const

const LEGACY_DEFAULT_PROMPT_PROFILE_SYSTEM = [
  '你是面向图像、视频和音频生成工作流的提示词优化助手。',
  '保留用户原意，补足主体、场景、风格、镜头、光线、构图和质量描述。',
  '只输出优化后的提示词，不要解释，不要添加标题。',
].join('\n')
const LEGACY_DEFAULT_PROMPT_PROFILE_USER = '请优化以下提示词，使其更适合生成模型使用：\n\n{{prompt}}'

export function normalizeTextProcessingPromptTemplates(
  input: TextProcessingPromptTemplate[] | undefined,
): TextProcessingPromptTemplate[] {
  if (input === undefined) return createDefaultTextProcessingPromptTemplates()

  const templates = input
    .map(normalizeTextProcessingPromptTemplate)
    .filter((template): template is TextProcessingPromptTemplate => template !== null)
  const hasCompleteLegacyBuiltIns = ORIGINAL_TEXT_PROCESSING_TEMPLATE_IDS
    .every((id) => templates.some((template) => template.id === id))
    && templates.some((template) => (
      LEGACY_TEXT_PROCESSING_PROMPTS[template.id]?.includes(template.systemPrompt) === true
    ))
  const defaults = createDefaultTextProcessingPromptTemplates()
  const now = new Date().toISOString()

  return templates.map((template) => {
    const legacyPrompts = LEGACY_TEXT_PROCESSING_PROMPTS[template.id] ?? []
    const defaultTemplate = defaults.find((item) => item.id === template.id)
    if (!defaultTemplate || !legacyPrompts.includes(template.systemPrompt)) return template
    return {
      ...template,
      name: template.name === defaultTemplate.name ? defaultTemplate.name : template.name,
      systemPrompt: defaultTemplate.systemPrompt,
      updatedAt: now,
    }
  }).concat(
    hasCompleteLegacyBuiltIns
      ? defaults.filter((template) => !templates.some((item) => item.id === template.id))
      : [],
  )
}

export function normalizePromptProfileWithBuiltInMigration(
  profile: PromptOptimizationProfile,
): PromptOptimizationProfile {
  const normalized = normalizePromptProfile(profile)
  if (normalized.id !== DEFAULT_PROMPT_PROFILE_ID) return normalized

  const defaults = createDefaultPromptProfile(normalized.createdAt)
  const nextProfile = { ...normalized }
  let changed = false
  if (normalized.systemPrompt === LEGACY_DEFAULT_PROMPT_PROFILE_SYSTEM) {
    nextProfile.systemPrompt = defaults.systemPrompt
    nextProfile.systemPromptDocument = undefined
    changed = true
  }
  if (normalized.userTemplate === LEGACY_DEFAULT_PROMPT_PROFILE_USER) {
    nextProfile.userTemplate = defaults.userTemplate
    nextProfile.userTemplateDocument = undefined
    changed = true
  }
  return changed ? normalizePromptProfile(nextProfile) : normalized
}
