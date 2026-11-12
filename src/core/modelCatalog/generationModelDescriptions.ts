import type { I18nText } from '../types/I18nText'

/**
 * 图片、视频、音频生成模型的通用描述。
 *
 * 这里只描述模型本身更擅长的方向、风格或相对定位，不重复 tags、参数 schema
 * 已经能够表达的固有能力。不同供应商接入同一个模型时复用同一条描述。
 * 推荐还是过时不写在描述里，登记在 generationModelStanding.ts。
 *
 * 新模型适配流程：
 * 1. 供应商模型文件只填写 meta.canonicalModelId，不填写 meta.description。
 * 2. 若这里已有对应 key，直接复用。
 * 3. 若这里没有对应 key，先新增空描述，再由维护者补充文案。
 */
export const GENERATION_MODEL_DESCRIPTIONS = {
  'nano-banana-2.1': { zh: '面向图像生成与参考图编辑的新版本，侧重视觉质量、文字呈现、提示词遵循和主体一致性。', en: 'An updated image generation and editing model focused on visual quality, text rendering, prompt adherence and subject consistency.' },
  'seedream-5.0-flash': { zh: 'Seedream 5.0 的快速低价版本，支持多图参考融合和用坐标或标记做局部编辑，适合高频出图与快速迭代。', en: 'The fast, low-cost tier of Seedream 5.0 with multi-image reference blending and coordinate or sketch-guided local edits, suited to high-volume output and quick iteration.' },
  'happyhorse-1.1': { zh: '文生、首帧图生和多图参考的视频模型，按上传素材自动切换生成方式，适合快速把图片和想法做成短片。', en: 'A video model for text-to-video, first-frame and multi-image reference generation that switches mode by the uploaded media, suited to turning images and ideas into short clips quickly.' },
  'ltx-2.3': { zh: 'Lightricks 开放权重音视频模型的新版本，画质、运动和声音同步较 LTX-2 明显提升，快速档价格低、可出长镜头，适合高分辨率与高帧率素材的批量生产。', en: 'An updated Lightricks open-weight audio-video model with better quality, motion and sound sync than LTX-2; the fast tier is inexpensive and suited to batches of high-resolution, high-frame-rate footage.' },
  'kling-video-4.0': { zh: '可灵新一代旗舰，强调多关键帧与多镜头叙事、主体与声音一致性，以及用自然语言改视频，适合长镜头剧情和精细可控的成片。', en: 'Kling’s next flagship, emphasizing multi-keyframe and multi-shot storytelling, subject and voice consistency, and natural-language video editing for long, controllable shots.' },
  'kling-video-4.0-flash': { zh: '可灵 4.0 的低价快速版，画质为 720P，适合高频试错和草稿。', en: 'The fast, low-cost 720P Kling 4.0 tier, suited to rapid iteration and drafts.' },
  'wan-3.0': { zh: '万相新一代音视频模型，可融合图片、视频、音频多路参考，生成前可先推理画面安排，长镜头叙事和提示词理解更强；Prime 档能力相同、出片更快、价格更高。', en: 'Wan’s next audio-video model that blends image, video and audio references and can reason about a shot before generating, with stronger long-shot storytelling; Prime has the same capability, renders faster and costs more.' },
  'gpt-image-2.6': { zh: 'OpenAI 图像模型的新版本，在 2.5 的基础上可调节出图前的构思深度，密集文字、复杂版式和精确修改更稳。', en: 'OpenAI’s updated image model that adds adjustable planning before rendering, making dense text, complex layouts and precise edits more reliable than 2.5.' },
  'gemini-omni-1.2-flash': { zh: 'Google Gemini Omni Flash 的新版本，生成与修改都在一个模型里完成，画面连贯、最高 4K，适合在同一条片子上反复修改。', en: 'An updated Gemini Omni Flash that handles generation and revision in one model with coherent output up to 4K, suited to iterating on the same clip.' },
  'grok-imagine-video-1.5': { zh: 'xAI 视频模型的新版本，出片快、表现力强，Lite 档价格很低，适合快速探索创意和社交短片。', en: 'An updated xAI video model that is fast and expressive; the Lite tier is very inexpensive for quick exploration and social clips.' },
  'minimax-h3-max': { zh: 'MiniMax H3 的高规格版本，人物表演、镜头运动与参考一致性更强；Turbo 档更快更便宜。', en: 'The premium MiniMax H3 tier with stronger performances, camera motion and reference consistency; Turbo is faster and cheaper.' },
  'flux-3': { zh: 'Black Forest Labs 新一代图像模型，写实质感、版式理解和文字呈现突出，可用多张参考图组合编辑，最高 4K。', en: 'Black Forest Labs’ next image model, strong at photoreal texture, layout understanding and text, with multi-reference editing up to 4K.' },
  'eleven-v4-tts': { zh: 'ElevenLabs 新一代语音合成，情绪与语气标签表现更自然；Turbo 档更快、价格减半。', en: 'ElevenLabs’ next speech model with more natural emotion and audio-tag delivery; Turbo is faster at half the price.' },
  'wan-2.7-image': { zh: '通义万相 2.7 图像模型，文生图与多图编辑合一，可一次生成风格统一的组图，Pro 版画质更高并支持 4K。', en: 'Wan 2.7 image model combining text-to-image and multi-image editing, able to produce a consistent image set in one go; Pro adds higher quality and 4K.' },
  'flux-3-video': { zh: 'Black Forest Labs 的视频模型，写实质感与镜头运动自然，支持多关键帧、视频续写与编辑，Max 版提示词遵循更好、速度更快。', en: 'Black Forest Labs’ video model with photoreal texture and natural camera motion, supporting multiple keyframes, extension and editing; Max follows prompts better and runs faster.' },
  // 图片模型
  'flux-1-krea-dev': { zh: 'Krea 与 Black Forest Labs 联合推出的 12B 开放权重模型，强调自然写实、设计感和较少的“AI 油亮感”；兼容 FLUX.1 Dev 生态，适合本地部署与微调。', en: 'A 12B open-weight model from Krea and Black Forest Labs that favors natural realism, design sense and less of the glossy “AI look”; compatible with the FLUX.1 Dev ecosystem for local deployment and fine-tuning.' },
  'flux-2-multiple-angles': { zh: '基于 FLUX.2 的连续镜头角度调整工具，可分别控制水平角度、垂直角度和缩放，适合商品与主体视角探索。', en: 'A FLUX.2 camera-angle tool with continuous horizontal, vertical, and zoom controls.' },
  'gpt-image-2': { zh: 'OpenAI 高端通用图像生成与编辑模型，文字排版、多语言、提示遵循和参考图保真表现突出，适合复杂商业视觉、海报及高精度修改。', en: 'OpenAI’s high-end general image generation and editing model, outstanding at text layout, multilingual text, prompt adherence and reference fidelity, suited to complex commercial visuals, posters and precise edits.' },
  'gpt-image-2.5': { zh: 'OpenAI 图像模型的 2.5 版本，文字排版、多语言、提示遵循和参考图编辑在 2 的基础上进一步加强，适合海报、信息图和商业视觉精修。', en: 'Version 2.5 of the OpenAI image model, further improving text layout, multilingual text, prompt adherence and reference editing over 2, suited to posters, infographics and polished commercial visuals.' },
  'flux-3-klein': { zh: 'Black Forest Labs FLUX 3 的轻量快速版本，单价很低、出图快，适合大批量草图、风格探索与日常改图。', en: 'The lightweight, fast tier of FLUX 3 with a very low per-image price, suited to bulk drafts, style exploration and everyday edits.' },
  'ic-light-v2': { zh: '专用图片重打光模型，支持文字描述与五档离散初始光照方向，适合人物、商品和室内画面的光照重绘；方向仅是生成偏好，不是物理精确灯位。', en: 'A dedicated relighting model with text prompts and five discrete initial light directions, suited to relighting people, products and interiors; the direction is a generation preference, not a physically exact light position.' },
  'grok-imagine-image': { zh: 'xAI 的对话式图片生成与编辑模型，侧重快速写实出图、风格变化和自然语言修改，分辨率比较低。', en: 'xAI’s conversational image generation and editing model, focused on fast photoreal output, style variation and natural-language edits, at a relatively low resolution.' },
  'grok-imagine-image-2.0': { zh: 'xAI 新一代图片生成与编辑模型，强化写实质感、提示遵循、连续修改和多图输出，适合快速探索视觉方案与对话式迭代。', en: 'xAI’s next image generation and editing model with stronger photoreal texture, prompt adherence, iterative edits and multi-image output, suited to quick visual exploration and conversational iteration.' },
  'kling-image-o1': { zh: '将图片生成与编辑统一在同一模型中，强项是多参考主体一致性、局部修改以及表情、光影和风格控制，适合连续角色和商业修图。', en: 'Unifies image generation and editing in one model, strong at multi-reference subject consistency, local edits and control over expression, lighting and style, suited to recurring characters and commercial retouching.' },
  'majicmix-realistic': { zh: '基于 Stable Diffusion 的社区写实 Checkpoint，擅长人物摄影和东方人像审美，兼容成熟的 LoRA、ControlNet 生态；不同版本差异较大，复杂文字和指令理解较弱。', en: 'A community photoreal Stable Diffusion checkpoint, good at portrait photography and East Asian portrait aesthetics and compatible with the mature LoRA and ControlNet ecosystem; versions vary widely and complex text and instructions are weak.' },
  'midjourney': { zh: '强调审美表现、氛围、构图和风格化成片质量的通用图片模型，适合概念设计、插画和高完成度视觉探索。', en: 'A general image model that emphasizes aesthetics, mood, composition and stylized finish, suited to concept design, illustration and polished visual exploration.' },
  'midjourney-video': { zh: '将 Midjourney 生成图或上传图片动画化为短视频，支持起止帧、运动幅度和批量生成。', en: 'Animates Midjourney images or uploaded pictures into short videos, with start and end frames, motion strength and batch generation.' },
  'modelscope-custom': { zh: '魔搭的动态自定义模型入口，并非固定基础模型，具体能力取决于用户登记的模型。', en: 'ModelScope’s dynamic custom-model entry rather than a fixed base model; capabilities depend on the model the user registered.' },
  'nano-banana': { zh: 'Google 初代 Gemini 原生图像模型，通常对应 Gemini 2.5 Flash Image，主打快速生成、多轮自然语言编辑和主体一致性；复杂文字及知识型构图弱于后续版本。', en: 'Google’s first Gemini-native image model, usually Gemini 2.5 Flash Image, focused on fast generation, multi-turn natural-language edits and subject consistency; weaker than later versions at complex text and knowledge-based layouts.' },
  'nano-banana-pro': { zh: '比 Nano Banana 更专业高质量版本，复杂推理、世界知识、多语言文字、品牌一致性和精细控制能力突出，适合海报、信息图和专业设计。', en: 'A more professional, higher-quality version of Nano Banana, outstanding at complex reasoning, world knowledge, multilingual text, brand consistency and fine control, suited to posters, infographics and professional design.' },
  'nano-banana-2': { zh: '能力接近 Nano Banana Pro、价格更低的版本。', en: 'Close to Nano Banana Pro in capability at a lower price.' },
  'nano-banana-2-lite': { zh: 'Nano Banana 2 的轻量版，仅支持 1K 分辨率，不过价格很便宜，适合测试或要求不高的场景。', en: 'A lightweight Nano Banana 2 limited to 1K resolution but very inexpensive, suited to testing or undemanding work.' },
  'qwen-image-2512': { zh: '阿里开源 20B 图像模型 Qwen-Image 的 2025 年 12 月更新版，人物更写实、自然纹理更细，中英文长文字渲染与复杂排版突出，适合海报和信息图。', en: 'The December 2025 update of Alibaba’s open-source 20B Qwen-Image, with more realistic people, finer natural textures, and outstanding long Chinese and English text and complex layouts, suited to posters and infographics.' },
  'qwen-image-edit-2511': { zh: 'Qwen 图片编辑的 2025 年 11 月迭代版，支持多图输入，进一步减轻编辑后的画面漂移，人物与多人一致性更好，适合精修、合成和连续内容制作。', en: 'The November 2025 Qwen image-editing release with multi-image input, less drift after edits and better single- and multi-person consistency, suited to retouching, compositing and serial content.' },
  'qwen-image-3.0': { zh: 'Qwen 新一代图像生成与编辑模型，强化复杂提示理解、多语言文字、知识型构图和多参考图一致性，适合海报、信息图与精细编辑。', en: 'Qwen’s next image generation and editing model with stronger complex-prompt understanding, multilingual text, knowledge-based layouts and multi-reference consistency, suited to posters, infographics and precise edits.' },
  'sdxl-14-checkpoint': { zh: '按名称判断为平台内 14 个 SDXL 社区 Checkpoint 的聚合入口，并非单一模型；优势是风格覆盖广、扩展生态成熟，实际能力取决于所选 Checkpoint。', en: 'Apparently an entry aggregating 14 community SDXL checkpoints on the platform rather than a single model; broad style coverage and a mature ecosystem, with actual results depending on the chosen checkpoint.' },
  'seedream-4.0': { zh: '字节跳动统一式图片生成与编辑模型，支持多图参考、主体一致性、知识型生成及原生 1K–4K 输出，生成速度和综合能力较为均衡。', en: 'ByteDance’s unified image generation and editing model with multi-image reference, subject consistency, knowledge-based generation and native 1K–4K output, balanced in speed and overall quality.' },
  'seedream-4.5': { zh: '4.0 的全面增强版，重点提升多主体识别、参考细节保留、密集文字排版和商业视觉一致性，更适合广告、电商及专业内容生产。', en: 'A broad upgrade of 4.0 that improves multi-subject recognition, reference detail retention, dense text layout and commercial visual consistency, better for advertising, e-commerce and professional content.' },
  'seedream-5.0-lite': { zh: '5.0 Pro 的轻量推理版本，能力与画质都弱一些，不过价格相比于 Pro 版本更加友好。', en: 'A lighter-inference version of 5.0 Pro with somewhat lower capability and quality, at a friendlier price than Pro.' },
  'seedream-5.0-pro': { zh: '旗舰专业版，侧重更高画质上限、复杂推理、精准局部编辑和多参考控制，适合广告、电商、设计及高要求成片制作。不过价格比较高。', en: 'The flagship professional version with a higher quality ceiling, complex reasoning, precise local edits and multi-reference control, suited to advertising, e-commerce, design and demanding final output, at a relatively high price.' },
  'topaz-image-upscale': { zh: 'Topaz 专用图片超分模型，提供标准、高保真、低清修复、CGI 和文字优化模式；适合在可控倍率下提升分辨率，不属于普通生图重绘。', en: 'Topaz’s dedicated image upscaler with standard, high-fidelity, low-resolution repair, CGI and text modes; it raises resolution at a controlled scale rather than regenerating the image.' },
  'topaz-transparent-upscale': { zh: 'Topaz 透明图专用放大，固定 4 倍并保留透明通道，适合抠好的主体、贴图和图标放大。', en: 'A Topaz upscaler for transparent images that enlarges 4× while keeping the alpha channel, suited to cut-out subjects, stickers and icons.' },
  'seedvr2-image-upscale': { zh: '基于 SeedVR2 的图片放大，2 倍或 4 倍提升分辨率，侧重还原细节、保持原图观感，价格较低。', en: 'A SeedVR2-based image upscaler at 2× or 4×, focused on restoring detail while keeping the original look, at a low price.' },
  'bria-creative-upscale': { zh: 'Bria 创意放大，2 倍放大时会补出新的纹理和细节，适合需要“变清晰”而非严格保真的画面。', en: 'Bria creative upscaling that adds new texture and detail at 2×, suited to images that need to look sharper rather than strictly faithful.' },
  'ideogram-upscale': { zh: 'Ideogram 图片放大，可调相似度与细节程度，在保留原貌和增强细节之间取舍。', en: 'Ideogram image upscaling with adjustable resemblance and detail, balancing faithfulness against added detail.' },
  'image-apps-v2-outpaint': { zh: 'FAL 智能扩图工具，可按四个方向指定像素扩展，或整体缩小原画面并补全四周内容。', en: 'A FAL outpainting tool with per-side expansion and zoom-out controls.' },
  'image-apps-v2-photo-restoration': { zh: 'FAL 老照片修复工具，可增强清晰度、校正颜色并去除划痕，适合扫描照片和受损影像。', en: 'A FAL photo restoration tool for resolution enhancement, color repair, and scratch removal.' },
  'image-apps-v2-relighting': { zh: 'FAL 预设重打光工具，提供自然光、棚拍光、逆光、霓虹等多种灯光风格，适合快速统一画面光照。', en: 'A FAL preset relighting tool with natural, studio, backlight, neon, and other lighting styles.' },
  'perspective-change': { zh: '离散方位视角调整工具，可将主体转换为正面、侧面、背面、俯视、仰视或三分之四等目标视角。', en: 'A discrete perspective tool for front, side, rear, top, bottom, and three-quarter views.' },
  'pixelcut-background-removal': { zh: '基于 Pixelcut 的 FAL 背景移除工具，可提取前景主体并输出透明背景图片。', en: 'A Pixelcut-powered FAL background removal tool that returns a transparent foreground image.' },
  'qwen-image-edit-2511-multiple-angles': { zh: '基于 Qwen Image Edit 2511 的多角度工具，支持完整水平环绕、仰视、俯视和景别缩放。', en: 'A Qwen Image Edit 2511 camera-angle tool with full horizontal rotation, low/high angles, and zoom controls.' },
  'z-image': { zh: '6B 开放权重完整模型，兼顾写实画质、风格多样性、中英文字渲染和提示遵循；生成自由度较高，推理速度慢于蒸馏版 Turbo。', en: 'A full 6B open-weight model balancing photoreal quality, style variety, Chinese and English text and prompt adherence; more generative freedom but slower than the distilled Turbo.' },
  'z-image-turbo': { zh: 'Z-Image 的蒸馏加速版，少量采样步数即可生成，显存要求较低并保留较好的写实及双语文字能力；适合高频本地出图。', en: 'The distilled, accelerated Z-Image that generates in few sampling steps with low VRAM needs while keeping good photorealism and bilingual text; suited to frequent local generation.' },

  // 视频模型
  'gemini-omni-video': { zh: 'Google 原生多模态对话式视频能力，当前对应 Gemini Omni Flash，可使用文本、图像、音频和视频进行生成与连续修改，非常适合用于修改编辑视频。', en: 'Google’s native multimodal conversational video capability, currently Gemini Omni Flash, generating and iteratively revising from text, images, audio and video; excellent for editing videos.' },
  'grok-imagine-video': { zh: 'xAI 的音视频联合生成模型，支持文生视频、图生视频及后续自然语言修改，突出快速生成、富表现力和同步声音；公开的专业控制规格相对有限。', en: 'xAI’s joint audio-video model for text-to-video, image-to-video and follow-up natural-language edits, emphasizing fast generation, expressiveness and synchronized sound; published professional controls are relatively limited.' },
  'hailuo-02': { zh: 'MiniMax 第二代视频模型，支持原生 1080P，强调指令遵循、真实物理运动和大幅动作稳定性，适合写实、电影感及高动态短镜头。', en: 'MiniMax’s second-generation video model with native 1080P, emphasizing instruction following, realistic physics and stable large motions, suited to photoreal, cinematic and high-motion short shots.' },
  'hailuo-2.3': { zh: '在 Hailuo 02 基础上强化人物微表情、复杂动作、风格化表现和运动响应，画面稳定性及角色表演能力进一步提升。', en: 'Builds on Hailuo 02 with better micro-expressions, complex actions, stylized looks and motion response, further improving stability and character performance.' },
  'kling-video-o1': { zh: '将视频生成、续写、换背景、增删元素和风格迁移统一在一个模型中，强项是人物与道具一致性及自然语言精确编辑，更接近完整视频后期工具。', en: 'Unifies video generation, extension, background replacement, adding or removing elements and style transfer in one model, strong at character and prop consistency and precise natural-language edits, closer to a full post-production tool.' },
  'kling-video-2.5-turbo': { zh: '面向速度和成本优化的文生、图生视频版本，具备稳定运动、较强提示遵循和电影化画面，适合高频试错、批量素材及短视频制作。', en: 'A speed- and cost-optimized text and image-to-video version with stable motion, strong prompt adherence and cinematic images, suited to rapid iteration, batch footage and short videos.' },
  'kling-video-2.6-pro': { zh: '在 2.5 系列基础上加入原生音频，可一次生成对白、环境音和音效，并提升人物表演及音画同步能力，适合完整视听短片。', en: 'Adds native audio to the 2.5 series, generating dialogue, ambience and sound effects in one pass with better performances and audio-video sync, suited to complete audiovisual shorts.' },
  'kling-video-3.0': { zh: '系列旗舰版本，支持最长 15 秒、多镜头叙事、多角色指代、原生音频及 4K 输出，在复杂剧情、一致性和专业成片能力上全面升级。', en: 'The series flagship with up to 15-second clips, multi-shot storytelling, multi-character references, native audio and 4K output, a broad upgrade in complex narratives, consistency and professional output.' },
  'kling-video-3.0-omni': { zh: 'Kling 3.0 的全模态版本，统一支持文本、图片、视频和元素参考，可进行生成、视频变换、多镜头叙事与原生音频创作。', en: 'The omni-modal Kling 3.0 that accepts text, image, video and element references for generation, video transformation, multi-shot storytelling and native audio.' },
  'kling-video-3.0-turbo': { zh: 'Kling 3.0 的低延迟高性价比版本，保留文生与图生视频、原生音频和最长 15 秒输出，适合高频试错与批量短片生产。', en: 'A low-latency, cost-effective Kling 3.0 that keeps text and image-to-video, native audio and up to 15-second output, suited to rapid iteration and batch shorts.' },
  'ltx-2': { zh: 'Lightricks 开源音视频联合模型，支持同步声音、原生 4K 和最高 50 帧/秒，便于本地部署、微调及工作流集成，适合重视开放性和可控性的开发者。', en: 'Lightricks’ open-source joint audio-video model with synchronized sound, native 4K and up to 50fps, easy to deploy locally, fine-tune and integrate, suited to developers who value openness and control.' },
  'minimax-h3': { zh: 'MiniMax 新一代多模态视频模型，支持文生、首尾帧和图片、视频、音频联合参考，侧重人物表演、镜头运动与叙事连续性。', en: 'MiniMax’s next multimodal video model with text-to-video, first-last frames and joint image, video and audio references, focused on character performance, camera motion and narrative continuity.' },
  'pixverse-v4.5': { zh: '成熟的快速文生和图生视频模型，强调运动响应、视觉效果及模板化创作，可输出最高 1080P 短片，适合社交媒体特效和快速内容生产。', en: 'A mature fast text and image-to-video model emphasizing motion response, visual effects and template-based creation, with up to 1080P shorts, suited to social effects and quick content.' },
  'pixverse-v5.5': { zh: '在 V4.5 基础上加入多镜头与原生音频，可联合生成对白、口型、表情、动作和环境声，更适合一键完成短剧情及社交媒体成片。', en: 'Adds multi-shot and native audio to V4.5, jointly generating dialogue, lip sync, expressions, actions and ambience, better for finishing short stories and social videos in one go.' },
  'seedance-v1': { zh: '字节跳动首代通用视频模型，统一支持文生和图生视频，具备原生多镜头叙事、1080P、稳定运动和丰富风格，主要聚焦高质量画面生成。', en: 'ByteDance’s first general video model for text and image-to-video, with native multi-shot storytelling, 1080P, stable motion and varied styles, focused on high-quality visuals.' },
  'seedance-1.5-pro': { zh: 'V1 的专业音视频升级版，加入原生联合音频、多人对话、多语言及方言口型和更强镜头调度，适合带对白的剧情、广告及人物表演。', en: 'A professional audio-video upgrade of V1 with native joint audio, multi-speaker dialogue, multilingual and dialect lip sync and stronger camera direction, suited to dialogue-driven stories, ads and performances.' },
  'seedance-2.0': { zh: '写实效果稳定的视频模型，可同时参考文本、图像、音频和视频，支持生成、编辑、延长及导演级控制，面向影视、广告和复杂连续创作。', en: 'A video model with consistently realistic output, referencing text, images, audio and video at once and supporting generation, editing, extension and director-level control for film, advertising and complex continuous work.' },
  'seedance-2.0-fast': { zh: 'Seedance 2.0 的低延迟加速版，保留多模态参考和音视频联合生成的核心能力，价格更低，生成速度更快，但效果略逊于原版。', en: 'The low-latency Seedance 2.0 that keeps multimodal references and joint audio-video generation at a lower price and faster speed, with slightly lower quality than the original.' },
  'seedance-2.0-mini': { zh: '2.0 系列的低成本轻量版本，价格比 Fast 版本更低，生成速度也更快，但效果也会更差，适合对效果要求不高，或测试场景。', en: 'The low-cost lightweight 2.0 tier, cheaper and faster than Fast but with lower quality, suited to undemanding work or testing.' },
  'seedance-2.5': { zh: 'Seedance 2.0 系列的后续专业版本，进一步强化多模态参考、音画同步、复杂镜头控制和长序列一致性，面向高要求影视与广告创作。', en: 'The professional follow-up to Seedance 2.0 with stronger multimodal references, audio-video sync, complex camera control and long-sequence consistency, aimed at demanding film and advertising work.' },
  'veo-3.1': { zh: 'Google 旗舰视频模型，原生生成对白、音效和环境声，物理真实感、提示遵循与音画同步突出；支持参考图、首尾帧、视频续写及最高 4K。', en: 'Google’s flagship video model that natively generates dialogue, sound effects and ambience, outstanding in physical realism, prompt adherence and audio-video sync; supports reference images, first-last frames, extension and up to 4K.' },
  'vidu-q1': { zh: 'Vidu 的高清一致性版本，主打清晰画面、平滑转场、稳定运镜和多参考主体保持，适合角色、IP 动画及短镜头，整体功能相对基础。', en: 'Vidu’s high-definition consistency version focused on clear images, smooth transitions, stable camera moves and multi-reference subject retention, suited to characters, IP animation and short shots, with relatively basic features.' },
  'vidu-q2': { zh: '在 Q1 基础上增强动态效果、画面细节和生成时长，支持文生、图生、参考生、首尾帧及视频延长，适合复杂运动和多主体内容。', en: 'Builds on Q1 with stronger dynamics, finer detail and longer clips, supporting text, image, reference, first-last frame generation and extension, suited to complex motion and multiple subjects.' },
  'vidu-q3': { zh: '新一代音视频一体化版本，支持智能分镜、同步对白与音效、最长 16 秒和更强多机位一致性，部分细分版本面向剧情及广告生产。', en: 'A new integrated audio-video version with smart shot planning, synchronized dialogue and sound effects, up to 16 seconds and stronger multi-camera consistency; some variants target story and ad production.' },
  'wan-2.5-preview': { zh: '万相首个原生音画同步版本，可同时生成对白、环境音效和背景音乐，支持 1080P、24 帧/秒 及最长 10 秒，奠定 Wan 音视频一体化能力。', en: 'Wan’s first native audio-video sync version, generating dialogue, ambience and background music together at 1080P, 24fps and up to 10 seconds, laying the foundation for Wan’s integrated audio-video capability.' },
  'wan-3.0-prime': { zh: '万相 3.0 的高速版本，能力与标准版一致，端到端出片更快、价格更高，适合赶时间的批量出片。', en: 'The high-speed tier of Wan 3.0 with the same capability as standard, faster end-to-end rendering and a higher price, suited to time-sensitive batches.' },

  // 音频模型
  'minimax-speech-2.8': { zh: 'MiniMax 新一代多语言语音合成模型，重点提升情绪控制、呼吸和笑声等语气标签及 10 秒高相似度音色克隆；HD 侧重拟真表现，Turbo 侧重速度和自然流畅度。', en: 'MiniMax’s next multilingual speech model with better emotion control, breath and laughter tags and high-similarity voice cloning from 10 seconds; HD favors realism, Turbo favors speed and natural flow.' },
  'qwen3-tts-1.7b': { zh: 'Qwen3 的多语言语音合成模型，可选择音色、语言和演绎风格。', en: 'Multilingual speech synthesis with voice and delivery controls.' },
  'eleven-v3-tts': { zh: 'ElevenLabs 的表现力语音合成模型，适合有情绪变化的朗读。', en: 'Expressive speech synthesis for natural narration.' },
  'qwen-audio-3.1-tts-flash': { zh: '通义千问快速语音合成模型，支持系统音色与演绎指令。', en: 'Fast speech synthesis with built-in voices and delivery instructions.' },
  'qwen-audio-3.1-tts-plus': { zh: '通义千问旗舰语音合成模型，音色更自然饱满，适合对配音质感要求高的旁白与角色演绎。', en: 'Qwen’s flagship speech synthesis with fuller, more natural voices, suited to narration and character performances that need polished delivery.' },
  'cosyvoice-v3.5': { zh: '百炼自定义音色语音合成，需要预先创建复刻或设计音色。', en: 'Speech synthesis using a previously created custom voice.' },
  'eleven-v3-dialogue': { zh: 'ElevenLabs 对话语音合成，支持按说话人组织台词。', en: 'Dialogue speech synthesis with per-turn voices.' },
  'gemini-3.1-flash-tts': { zh: 'Gemini 语音合成，可通过结构化说话人和台词生成对话。', en: 'Speech synthesis using structured speakers and dialogue turns.' },
  'gemini-3.8-flash-tts': { zh: 'Gemini 3.8 语音合成，音色更丰富、语气标签和逐句风格描述更细，适合有表演感的旁白与对话。', en: 'Gemini 3.8 speech synthesis with more voices, richer tone tags and per-line style direction, suited to expressive narration and dialogue.' },
  'gemini-3.8-flash-lite-tts': { zh: 'Gemini 3.8 语音合成的轻量版，延迟和价格更低，适合大批量配音与语音助手。', en: 'The lightweight tier of Gemini 3.8 speech synthesis with lower latency and price, suited to high-volume voiceover and voice agents.' },
  'cosyvoice2-0.5b': { zh: '硅基流动托管的 CosyVoice2 语音合成模型。', en: 'CosyVoice2 speech synthesis hosted by SiliconFlow.' },
  'moss-ttsd-v0.5': { zh: '硅基流动托管的多说话人对话语音模型。', en: 'Multi-speaker dialogue speech synthesis hosted by SiliconFlow.' },
  'seed-tts-2.0': { zh: '豆包新一代语音合成模型，可选择平台音色。', en: 'Doubao speech synthesis with platform voices.' },
  'seed-icl-2.0': { zh: '豆包复刻音色语音合成，需要预先创建音色。', en: 'Doubao speech synthesis using a previously cloned voice.' },
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
