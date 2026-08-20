import type { I18nText } from '../types/I18nText'

/**
 * 图片、视频、音频生成模型的通用描述。
 *
 * 这里只描述模型本身更擅长的方向、风格或相对定位，不重复 tags、参数 schema
 * 已经能够表达的固有能力。不同供应商接入同一个模型时复用同一条描述。
 *
 * 新模型适配流程：
 * 1. 供应商模型文件只填写 meta.canonicalModelId，不填写 meta.description。
 * 2. 若这里已有对应 key，直接复用。
 * 3. 若这里没有对应 key，先新增空描述，再由维护者补充文案。
 */
export const GENERATION_MODEL_DESCRIPTIONS = {
  // 图片模型
  'flux-1-krea-dev': { zh: 'Krea 与 Black Forest Labs 联合推出的 12B 开放权重模型，强调自然写实、设计感和较少的“AI 油亮感”；兼容 FLUX.1 Dev 生态，适合本地部署与微调。', en: '' },
  'gpt-image-2': { zh: '推荐使用！OpenAI 高端通用图像生成与编辑模型，文字排版、多语言、提示遵循和参考图保真表现突出，适合复杂商业视觉、海报及高精度修改。', en: '' },
  'grok-imagine-image': { zh: 'xAI 的对话式图片生成与编辑模型，侧重快速写实出图、风格变化和自然语言修改，分辨率比较低。', en: '' },
  'grok-imagine-image-2.0': { zh: '', en: '' },
  'kling-image-o1': { zh: '将图片生成与编辑统一在同一模型中，强项是多参考主体一致性、局部修改以及表情、光影和风格控制，适合连续角色和商业修图。', en: '' },
  'majicmix-realistic': { zh: '基于 Stable Diffusion 的社区写实 Checkpoint，擅长人物摄影和东方人像审美，兼容成熟的 LoRA、ControlNet 生态；不同版本差异较大，复杂文字和指令理解较弱。', en: '' },
  'midjourney': { zh: '', en: '' },
  'modelscope-custom': { zh: 'ModelScope 的动态自定义模型入口，并非固定基础模型，不推荐智能助手使用。', en: '' },
  'nano-banana': { zh: 'Google 初代 Gemini 原生图像模型，通常对应 Gemini 2.5 Flash Image，主打快速生成、多轮自然语言编辑和主体一致性；复杂文字及知识型构图弱于后续版本。有些过时，已不太推荐。', en: '' },
  'nano-banana-pro': { zh: '比 Nano Banana 更专业高质量版本，复杂推理、世界知识、多语言文字、品牌一致性和精细控制能力突出，适合海报、信息图和专业设计。', en: '' },
  'nano-banana-2': { zh: '推荐使用！接近 Nano Banana Pro 的能力同时价格更便宜，所以相比于 Pro 大多数情况下更推荐使用这个版本。', en: '' },
  'nano-banana-2-lite': { zh: 'Nano Banana 2 的轻量版，仅支持 1K 分辨率，不过价格很便宜，适合测试或要求不高的场景。', en: '' },
  'qwen-image': { zh: '阿里开源的 20B 图像模型，中文和英文长文字渲染、复杂排版及语义理解突出，适合海报和信息图；本地运行所需算力相对较高。', en: '' },
  'qwen-image-edit-2509': { zh: '面向图片编辑的 2025 年 9 月迭代版，新增多图输入并强化主体一致性、文字替换、姿态及草图控制，更适合精修、合成和连续内容制作。', en: '' },
  'qwen-image-3.0': { zh: '', en: '' },
  'sdxl-14-checkpoint': { zh: '按名称判断为平台内 14 个 SDXL 社区 Checkpoint 的聚合入口，并非单一模型；优势是风格覆盖广、扩展生态成熟，实际能力取决于所选 Checkpoint。', en: '' },
  'seedream-4.0': { zh: '字节跳动统一式图片生成与编辑模型，支持多图参考、主体一致性、知识型生成及原生 1K–4K 输出，生成速度和综合能力较为均衡。有些过时，已不太推荐。', en: '' },
  'seedream-4.5': { zh: '4.0 的全面增强版，重点提升多主体识别、参考细节保留、密集文字排版和商业视觉一致性，更适合广告、电商及专业内容生产。有些过时，已不太推荐。', en: '' },
  'seedream-5.0-lite': { zh: '5.0 Pro 的轻量推理版本，能力与画质都弱一些，不过价格相比于 Pro 版本更加友好。', en: '' },
  'seedream-5.0-pro': { zh: '旗舰专业版，侧重更高画质上限、复杂推理、精准局部编辑和多参考控制，适合广告、电商、设计及高要求成片制作。不过价格比较高。', en: '' },
  'z-image': { zh: '6B 开放权重完整模型，兼顾写实画质、风格多样性、中英文字渲染和提示遵循；生成自由度较高，推理速度慢于蒸馏版 Turbo。', en: '' },
  'z-image-turbo': { zh: 'Z-Image 的蒸馏加速版，少量采样步数即可生成，显存要求较低并保留较好的写实及双语文字能力；适合高频本地出图。', en: '' },

  // 视频模型
  'gemini-omni-video': { zh: '推荐使用！Google 原生多模态对话式视频能力，当前对应 Gemini Omni Flash，可使用文本、图像、音频和视频进行生成与连续修改，非常适合用于修改编辑视频。', en: '' },
  'grok-imagine-video': { zh: 'xAI 的音视频联合生成模型，支持文生视频、图生视频及后续自然语言修改，突出快速生成、富表现力和同步声音；公开的专业控制规格相对有限。', en: '' },
  'hailuo-02': { zh: 'MiniMax 第二代视频模型，支持原生 1080p，强调指令遵循、真实物理运动和大幅动作稳定性，适合写实、电影感及高动态短镜头。', en: '' },
  'hailuo-2.3': { zh: '在 Hailuo 02 基础上强化人物微表情、复杂动作、风格化表现和运动响应，画面稳定性及角色表演能力进一步提升。', en: '' },
  'kling-video-o1': { zh: '将视频生成、续写、换背景、增删元素和风格迁移统一在一个模型中，强项是人物与道具一致性及自然语言精确编辑，更接近完整视频后期工具。', en: '' },
  'kling-video-2.5-turbo': { zh: '面向速度和成本优化的文生、图生视频版本，具备稳定运动、较强提示遵循和电影化画面，适合高频试错、批量素材及短视频制作。', en: '' },
  'kling-video-2.6-pro': { zh: '在 2.5 系列基础上加入原生音频，可一次生成对白、环境音和音效，并提升人物表演及音画同步能力，适合完整视听短片。', en: '' },
  'kling-video-3.0': { zh: '系列旗舰版本，支持最长 15 秒、多镜头叙事、多角色指代、原生音频及 4K 输出，在复杂剧情、一致性和专业成片能力上全面升级。', en: '' },
  'kling-video-3.0-omni': { zh: '', en: '' },
  'kling-video-3.0-turbo': { zh: '', en: '' },
  'ltx-2': { zh: 'Lightricks 开源音视频联合模型，支持同步声音、原生 4K 和最高 50fps，便于本地部署、微调及工作流集成，适合重视开放性和可控性的开发者。', en: '' },
  'minimax-h3': { zh: '', en: '' },
  'pixverse-v4.5': { zh: '成熟的快速文生和图生视频模型，强调运动响应、视觉效果及模板化创作，可输出最高 1080p 短片，适合社交媒体特效和快速内容生产。', en: '' },
  'pixverse-v5.5': { zh: '在 V4.5 基础上加入多镜头与原生音频，可联合生成对白、口型、表情、动作和环境声，更适合一键完成短剧情及社交媒体成片。', en: '' },
  'seedance-v1': { zh: '字节跳动首代通用视频模型，统一支持文生和图生视频，具备原生多镜头叙事、1080p、稳定运动和丰富风格，主要聚焦高质量画面生成。', en: '' },
  'seedance-1.5-pro': { zh: 'V1 的专业音视频升级版，加入原生联合音频、多人对话、多语言及方言口型和更强镜头调度，适合带对白的剧情、广告及人物表演。', en: '' },
  'seedance-2.0': { zh: '推荐使用！目前最强的视频模型，可同时参考文本、图像、音频和视频，支持生成、编辑、延长及导演级控制，面向影视、广告和复杂连续创作。', en: '' },
  'seedance-2.0-fast': { zh: '推荐使用！Seedance 2.0 的低延迟加速版，保留多模态参考和音视频联合生成的核心能力，价格更低，生成速度更快，但效果略逊于原版。', en: '' },
  'seedance-2.0-mini': { zh: '推荐使用！2.0 系列的低成本轻量版本，价格比 Fast 版本更低，生成速度也更快，但效果也会更差，适合对效果要求不高，或测试场景。', en: '' },
  'seedance-2.5': { zh: '', en: '' },
  'veo-3.1': { zh: 'Google 旗舰视频模型，原生生成对白、音效和环境声，物理真实感、提示遵循与音画同步突出；支持参考图、首尾帧、视频续写及最高 4K。', en: '' },
  'vidu-q1': { zh: 'Vidu 的高清一致性版本，主打清晰画面、平滑转场、稳定运镜和多参考主体保持，适合角色、IP 动画及短镜头，整体功能相对基础。', en: '' },
  'vidu-q2': { zh: '在 Q1 基础上增强动态效果、画面细节和生成时长，支持文生、图生、参考生、首尾帧及视频延长，适合复杂运动和多主体内容。', en: '' },
  'vidu-q3': { zh: '新一代音视频一体化版本，支持智能分镜、同步对白与音效、最长 16 秒和更强多机位一致性，部分细分版本面向剧情及广告生产。', en: '' },
  'wan-2.5-preview': { zh: '万相首个原生音画同步版本，可同时生成对白、环境音效和背景音乐，支持 1080p、24fps 及最长 10 秒，奠定 Wan 音视频一体化能力。', en: '' },
  'wan-2.6': { zh: '在 2.5 上提升画质、音效、指令遵循和主体一致性，扩展至最长 15 秒，并新增参考角色、多镜头分镜及多人互动，定位更偏专业叙事。', en: '' },
  'wan-2.7': { zh: '当前综合创作版本，支持文本、图像、音频和视频输入，以及首尾帧、视频续写、多镜头、同步配音和指令式编辑，控制维度明显扩展。', en: '' },

  // 音频模型
  'minimax-speech-2.8': { zh: 'MiniMax 新一代多语言语音合成模型，重点提升情绪控制、呼吸和笑声等语气标签及 10 秒高相似度音色克隆；HD 侧重拟真表现，Turbo 侧重速度和自然流畅度。', en: '' },
} as const satisfies Record<string, I18nText>

export type CanonicalGenerationModelId = keyof typeof GENERATION_MODEL_DESCRIPTIONS

export function hasGenerationModelDescription(
  canonicalModelId: string
): canonicalModelId is CanonicalGenerationModelId {
  return Object.prototype.hasOwnProperty.call(GENERATION_MODEL_DESCRIPTIONS, canonicalModelId)
}

export function getGenerationModelDescription(
  canonicalModelId: string
): I18nText | undefined {
  if (!hasGenerationModelDescription(canonicalModelId)) return undefined
  const description = GENERATION_MODEL_DESCRIPTIONS[canonicalModelId]
  return description.zh.trim() || description.en.trim() ? description : undefined
}
