/**
 * 助手选生成模型时的推荐程度，按通用模型标识登记，所有供应商共用。
 *
 * - preferred：现在新、流行、效果好或性价比突出，用户没指定时优先用。
 * - legacy：已被同系或同类的新版本取代，或同价位明显更差；用户没点名就别用。
 * - 没登记的就是一般可用。
 *
 * 依据盲测榜（Artificial Analysis、Arena）、厂商发布记录与社区评测综合判断，新的不一定更好。
 * 调研原文与出处见 docs/task/模型真实请求验收/模型推荐调研.md；模型更新换代后要重新核对。
 */
export const GENERATION_MODEL_STANDING_REVIEWED_AT = '2026-11-08'

export type GenerationModelStanding = 'preferred' | 'standard' | 'legacy'

const preferred = (reason: string) => ({ standing: 'preferred' as const, reason })
const legacy = (reason: string) => ({ standing: 'legacy' as const, reason })

const STANDINGS: Readonly<Record<string, { standing: 'preferred' | 'legacy'; reason: string }>> = {
  // 图片
  'gpt-image-2.6': preferred('综合第一：文字排版、写实与编辑都最强，价格偏贵'),
  'nano-banana-2.1': preferred('高质量里性价比最高，2K/4K；大段或多语言文字改用 Nano Banana Pro'),
  'grok-imagine-image-2.0': preferred('质量接近第一梯队，中等价位'),
  'seedream-5.0-pro': preferred('编辑能力强，偏贵'),
  'seedream-5.0-flash': preferred('便宜，适合批量草稿'),
  'qwen-image-3.0': preferred('中文文字与国内题材'),
  'flux-3': preferred('写实质感与版式，中等价位'),
  'flux-3-klein': preferred('很便宜、出图快，适合快速出图和草稿'),
  'nano-banana': legacy('被 Nano Banana 2.1 取代'),
  'nano-banana-2': legacy('被 Nano Banana 2.1 超过，价格还更高'),
  'nano-banana-2-lite': legacy('与 Nano Banana 2.1 同价但质量更低'),
  'gpt-image-2': legacy('与 GPT Image 2.6 同价，直接用 2.6'),
  'seedream-4.0': legacy('被 Seedream 5.0 系列取代'),
  'grok-imagine-image': legacy('被 Grok Imagine Image 2.0 取代'),
  'flux-1-krea-dev': legacy('2025 年的开放模型，被 FLUX 3 / Klein 超过'),
  'majicmix-realistic': legacy('老一代社区模型，用户点名这种风格时再用'),
  'sdxl-14-checkpoint': legacy('老一代社区模型，用户点名这种风格时再用'),
  'modelscope-custom': legacy('用户自己登记的魔搭模型入口，不是固定模型，用户点名时才用'),
  // 视频
  'gemini-omni-1.2-flash': preferred('盲测文生与图生视频双第一，带声音、可多轮修改，中等价位'),
  'wan-3.0': preferred('文生视频榜第一，最长 30 秒、多路参考，中等价位'),
  'minimax-h3': preferred('性价比最高，原生 2K 带声音'),
  'seedance-2.0': preferred('写实最稳，中等价位'),
  'seedance-2.5': preferred('15–30 秒长镜头与多参考素材，价格是 2.0 的两三倍，短片段用 2.0'),
  'flux-3-video': preferred('提示词遵循与口型较好，中等偏贵'),
  'kling-video-4.0': preferred('有参考图、关键帧或要 30 秒一镜时优先；纯文字写实不如 Seedance 2.0'),
  'seedance-2.0-mini': preferred('便宜的草稿档'),
  'veo-3.1': legacy('又贵又不如 Gemini Omni，Google 现在主推 Omni'),
  'gemini-omni-video': legacy('被 Gemini Omni 1.2 Flash 取代'),
  'seedance-v1': legacy('被 Seedance 2.0 系列取代'),
  'seedance-1.5-pro': legacy('被 Seedance 2.0 系列取代'),
  'wan-2.5-preview': legacy('被万相 3.0 取代'),
  'hailuo-02': legacy('被 MiniMax H3 取代'),
  'hailuo-2.3': legacy('被 MiniMax H3 取代'),
  'kling-video-2.6-pro': legacy('被可灵 3.0 / 4.0 取代'),
  'kling-video-o1': legacy('被可灵 3.0 Omni / 4.0 取代'),
  'pixverse-v5.5': legacy('老版本，排名中下游'),
  'vidu-q2': legacy('被 Vidu Q3 取代'),
  'ltx-2': legacy('被 LTX-2.3 取代'),
  'grok-imagine-video': legacy('被 Grok Imagine Video 1.5 取代'),
  'midjourney-video': legacy('只能短片段图生视频、没有声音'),
  // 语音合成
  'eleven-v4-tts': preferred('语音合成榜第一，情感最好，英文与多语种，价格贵'),
  'qwen-audio-3.1-tts-plus': preferred('中文强、价格中等，高质量里性价比最高'),
  'gemini-3.8-flash-tts': preferred('质量高、中等价位'),
  'gemini-3.8-flash-lite-tts': preferred('便宜，质量仍不错'),
  'qwen-audio-3.1-tts-flash': preferred('便宜、可流式，适合批量与实时'),
  'seed-tts-2.0': preferred('中文音色多，适合短视频配音，便宜'),
  'cosyvoice-v3.5': preferred('中文便宜'),
  'seed-icl-2.0': preferred('中文声音克隆首选'),
  'eleven-v3-tts': legacy('被更便宜的 Eleven v4 取代'),
  'gemini-3.1-flash-tts': legacy('被 Gemini 3.8 Flash TTS 取代'),
  'qwen3-tts-1.7b': legacy('开源小模型，被 Qwen-Audio 3.1 TTS 取代'),
  'cosyvoice2-0.5b': legacy('开源小模型，被 CosyVoice 3.5 取代'),
  'moss-ttsd-v0.5': legacy('上游已有更新版本'),
}

const STANDING_ORDER: Readonly<Record<GenerationModelStanding, number>> = { preferred: 2, standard: 1, legacy: 0 }

/** 排序用：preferred 在前，legacy 在后。 */
export function generationModelStandingRank(canonicalModelId: string): number {
  return STANDING_ORDER[getGenerationModelStanding(canonicalModelId).standing]
}

export function getGenerationModelStanding(canonicalModelId: string): { standing: GenerationModelStanding; reason?: string } {
  return STANDINGS[canonicalModelId] ?? { standing: 'standard' }
}

export function listGenerationModelStandingIds(): string[] {
  return Object.keys(STANDINGS)
}
