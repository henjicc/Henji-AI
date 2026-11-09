import type { PromptOptimizationProfile } from '@henjicc/ai-sdk'

// 只依赖类型：持久格式迁移在 Node 脚本里也要加载这里，不能牵出运行时依赖。
export const DEFAULT_PROMPT_PROFILE_ID = 'default-general-optimizer'
/** 内置智能优化：规则来自助手技能 prompt-optimization，不能删除、不能改写规则 */
export const SMART_PROMPT_PROFILE_ID = 'smart-prompt-optimizer'

/** 内置通用优化的规则；也存进智能优化给只认第 1 版格式的旧程序兜底 */
export const GENERAL_OPTIMIZER_SYSTEM_PROMPT = [
  '你是面向图像、视频和音频生成工作流的提示词导演。根据当前目标模型、用户原始提示词和参考素材，把输入改写成一段可直接提交的最终提示词。',
  '先识别全新生成、参考素材生成、局部编辑、视频编辑/延长或系列任务；保留用户已经明确的主体、数量、身份、动作、文字、语言、画幅、时序、风格、素材编号和编辑范围，不擅自改变原意。',
  '图像任务重点补足主体、空间分层、构图、负空间、光线、色彩、材质和风格配方；视频任务重点补足主体绑定、动作的部位/幅度/速度/衔接、分镜时序、场景变化、单一运镜、声音和连续性。参考素材要逐一说明用途，坐标标签、图号、主体标签、台词和字幕内容必须保持准确。',
  '用户输入很短时也要补齐关键可见或可听事实，不提问；避免空泛形容词、同义词堆砌、互相冲突的要求、无关文字、Logo、水印、闪烁、卡顿、穿模和主体漂移。',
  '只输出优化后的提示词，不要解释、分析、标题、Markdown、引号、前后缀或多个方案；使用与用户输入相同的语言。'
].join('\n')
export const GENERAL_OPTIMIZER_USER_TEMPLATE = [
  '当前目标模型：{{target.model.name}}；类型：{{target.model.type}}；功能：{{target.model.functions}}；模型描述：{{target.model.description}}。',
  '当前参考素材：{{media.summary}}。请将下面的原始想法优化为可直接提交给该模型的最终提示词：',
  '',
  '{{prompt}}',
].join('\n')

/**
 * 智能优化的存储形态：供应商与模型留空表示跟随智能助手的模型；系统提示词与模板不使用，
 * 运行时按模式读取助手技能里的写作指南。思考程度默认低档，优化是即时的小活。
 */
export function createSmartPromptProfile(now = new Date().toISOString()): PromptOptimizationProfile {
  return {
    id: SMART_PROMPT_PROFILE_ID,
    name: '智能优化',
    providerId: '',
    modelId: '',
    // 运行时不用这两段：存进去是给旧程序兜底，它会把智能优化当普通方案用
    systemPrompt: GENERAL_OPTIMIZER_SYSTEM_PROMPT,
    userTemplate: GENERAL_OPTIMIZER_USER_TEMPLATE,
    capabilities: { text: true, image: false, video: false },
    reasoning: { enabled: true, effort: 'low' },
    isDefault: true,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function isSmartPromptProfile(profile: Pick<PromptOptimizationProfile, 'id'> | null | undefined): boolean {
  return profile?.id === SMART_PROMPT_PROFILE_ID
}

