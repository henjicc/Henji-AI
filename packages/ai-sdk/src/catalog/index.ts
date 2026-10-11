/**
 * 由 scripts/generate-catalog-index.cjs 自动生成。
 * 显式导入保证 catalog 不依赖 Vite 专有目录扫描，可被 UXP/Tauri/Node 打包器消费。
 */

import type { ModelRuntimeDefinition } from '../types/model'
import { createModelIndex } from './model-index'
import catalogModel1 from './apimart/gemini-omni-flash.model'
import catalogModel2 from './apimart/gpt-image-2.5.model'
import catalogModel3 from './apimart/gpt-image-2.model'
import catalogModel4 from './apimart/grok-imagine-2.0.model'
import catalogModel5 from './apimart/kling-3.0-omni.model'
import catalogModel6 from './apimart/kling-3.0-turbo.model'
import catalogModel7 from './apimart/kling-3.0.model'
import catalogModel8 from './apimart/midjourney-video.model'
import catalogModel9 from './apimart/midjourney.model'
import catalogModel10 from './apimart/minimax-h3.model'
import catalogModel11 from './apimart/nano-banana-2-lite.model'
import catalogModel12 from './apimart/nano-banana-2.1.model'
import catalogModel13 from './apimart/nano-banana-2.model'
import catalogModel14 from './apimart/nano-banana-pro.model'
import catalogModel15 from './apimart/qwen-image-3.0.model'
import catalogModel16 from './apimart/seedance-2.0-fast.model'
import catalogModel17 from './apimart/seedance-2.0-mini.model'
import catalogModel18 from './apimart/seedance-2.0.model'
import catalogModel19 from './apimart/seedance-2.5.model'
import catalogModel20 from './apimart/seedream-5.0-lite.model'
import catalogModel21 from './apimart/seedream-5.0-pro.model'
import catalogModel22 from './apimart/z-image-turbo.model'
import catalogModel23 from './bailian/cosyvoice-v3.5.model'
import catalogModel24 from './bailian/minimax-speech-2.8.model'
import catalogModel25 from './bailian/qwen-audio-3.1-tts-flash.model'
import catalogModel26 from './bailian/qwen-image-3.0.model'
import catalogModel27 from './bailian/z-image-turbo.model'
import catalogModel28 from './fal/bria-creative-upscale.model'
import catalogModel29 from './fal/eleven-v3-tts.model'
import catalogModel30 from './fal/gemini-omni-flash.model'
import catalogModel31 from './fal/gpt-image-2.5.model'
import catalogModel32 from './fal/gpt-image-2.model'
import catalogModel33 from './fal/grok-imagine-2.0.model'
import catalogModel34 from './fal/hailuo-02.model'
import catalogModel35 from './fal/hailuo-2.3.model'
import catalogModel36 from './fal/ic-light-v2.model'
import catalogModel37 from './fal/ideogram-upscale.model'
import catalogModel38 from './fal/kling-3.0-omni.model'
import catalogModel39 from './fal/kling-3.0-turbo.model'
import catalogModel40 from './fal/kling-3.0.model'
import catalogModel41 from './fal/kling-image-o1.model'
import catalogModel42 from './fal/kling-video-o1.model'
import catalogModel43 from './fal/kling-video-v2.6-pro.model'
import catalogModel44 from './fal/ltx-2.model'
import catalogModel45 from './fal/minimax-h3.model'
import catalogModel46 from './fal/minimax-speech-2.8.model'
import catalogModel47 from './fal/nano-banana-2.1.model'
import catalogModel48 from './fal/nano-banana-2.model'
import catalogModel49 from './fal/nano-banana-pro.model'
import catalogModel50 from './fal/nano-banana.model'
import catalogModel51 from './fal/pixverse-v5.5.model'
import catalogModel52 from './fal/qwen-image-3.0.model'
import catalogModel53 from './fal/qwen3-tts-1.7b.model'
import catalogModel54 from './fal/seedance-2.0-fast.model'
import catalogModel55 from './fal/seedance-2.0-mini.model'
import catalogModel56 from './fal/seedance-2.0.model'
import catalogModel57 from './fal/seedance-2.5.model'
import catalogModel58 from './fal/seedance.model'
import catalogModel59 from './fal/seedream-5.0-lite.model'
import catalogModel60 from './fal/seedream-5.0-pro.model'
import catalogModel61 from './fal/seedream-v4.5.model'
import catalogModel62 from './fal/seedream-v4.model'
import catalogModel63 from './fal/seedvr2-image-upscale.model'
import catalogModel64 from './fal/topaz-image-upscale.model'
import catalogModel65 from './fal/topaz-transparent-upscale.model'
import catalogModel66 from './fal/veo-3.1.model'
import catalogModel67 from './fal/vidu-q2.model'
import catalogModel68 from './fal/wan-2.5-preview.model'
import catalogModel69 from './fal/z-image-turbo.model'
import catalogModel70 from './grsai/gpt-image-2.5.model'
import catalogModel71 from './grsai/gpt-image-2.model'
import catalogModel72 from './grsai/nano-banana-2-lite.model'
import catalogModel73 from './grsai/nano-banana-2.1.model'
import catalogModel74 from './grsai/nano-banana-2.model'
import catalogModel75 from './grsai/nano-banana-pro.model'
import catalogModel76 from './kie/eleven-turbo-2.5-tts.model'
import catalogModel77 from './kie/eleven-v3-dialogue.model'
import catalogModel78 from './kie/gemini-3.1-flash-tts.model'
import catalogModel79 from './kie/gemini-omni-video.model'
import catalogModel80 from './kie/gpt-image-2.5.model'
import catalogModel81 from './kie/gpt-image-2.model'
import catalogModel82 from './kie/grok-imagine-2.0.model'
import catalogModel83 from './kie/grok-imagine-video.model'
import catalogModel84 from './kie/grok-imagine.model'
import catalogModel85 from './kie/hailuo-02.model'
import catalogModel86 from './kie/hailuo-2-3.model'
import catalogModel87 from './kie/happyhorse-1.1.model'
import catalogModel88 from './kie/kling-3.0-omni.model'
import catalogModel89 from './kie/kling-3.0-turbo.model'
import catalogModel90 from './kie/kling-3.0.model'
import catalogModel91 from './kie/kling-v2-6.model'
import catalogModel92 from './kie/minimax-h3.model'
import catalogModel93 from './kie/nano-banana-2-lite.model'
import catalogModel94 from './kie/nano-banana-2.1.model'
import catalogModel95 from './kie/nano-banana-2.model'
import catalogModel96 from './kie/nano-banana-pro.model'
import catalogModel97 from './kie/qwen-image-3.0.model'
import catalogModel98 from './kie/seedance-1.5-pro.model'
import catalogModel99 from './kie/seedance-2.0-fast.model'
import catalogModel100 from './kie/seedance-2.0-mini.model'
import catalogModel101 from './kie/seedance-2.0.model'
import catalogModel102 from './kie/seedance-2.5.model'
import catalogModel103 from './kie/seedance-v1.model'
import catalogModel104 from './kie/seedream-4.0.model'
import catalogModel105 from './kie/seedream-4.5.model'
import catalogModel106 from './kie/seedream-5.0-lite.model'
import catalogModel107 from './kie/seedream-5.0-pro.model'
import catalogModel108 from './kie/z-image.model'
import catalogModel109 from './modelscope/flux-1-krea-dev.model'
import catalogModel110 from './modelscope/majicmix-realistic.model'
import catalogModel111 from './modelscope/modelscope-custom.model'
import catalogModel112 from './modelscope/qwen-image-edit-2509.model'
import catalogModel113 from './modelscope/qwen-image.model'
import catalogModel114 from './modelscope/sdxl-14-ckpt.model'
import catalogModel115 from './modelscope/z-image-turbo.model'
import catalogModel116 from './ppio/kling-3.0.model'
import catalogModel117 from './ppio/minimax-speech.model'
import catalogModel118 from './siliconflow/cosyvoice2-tts.model'
import catalogModel119 from './siliconflow/moss-ttsd-0.5.model'
import catalogModel120 from './volcengine-speech/seed-icl-2.0.model'
import catalogModel121 from './volcengine-speech/seed-tts-2.0.model'
import catalogModel122 from './volcengine/seedream-5.0-flash.model'
import catalogModel123 from './volcengine/seedream-5.0-lite.model'
import catalogModel124 from './volcengine/seedream-5.0-pro.model'

export * from './defineModel'
export * from './model-index'
export * from './validate'
export * from './conditions'
export * from './consumer-contract'
export * from './modelscope/customModelRegistry'

export const catalog: readonly ModelRuntimeDefinition[] = [
  catalogModel1,
  catalogModel2,
  catalogModel3,
  catalogModel4,
  catalogModel5,
  catalogModel6,
  catalogModel7,
  catalogModel8,
  catalogModel9,
  catalogModel10,
  catalogModel11,
  catalogModel12,
  catalogModel13,
  catalogModel14,
  catalogModel15,
  catalogModel16,
  catalogModel17,
  catalogModel18,
  catalogModel19,
  catalogModel20,
  catalogModel21,
  catalogModel22,
  catalogModel23,
  catalogModel24,
  catalogModel25,
  catalogModel26,
  catalogModel27,
  catalogModel28,
  catalogModel29,
  catalogModel30,
  catalogModel31,
  catalogModel32,
  catalogModel33,
  catalogModel34,
  catalogModel35,
  catalogModel36,
  catalogModel37,
  catalogModel38,
  catalogModel39,
  catalogModel40,
  catalogModel41,
  catalogModel42,
  catalogModel43,
  catalogModel44,
  catalogModel45,
  catalogModel46,
  catalogModel47,
  catalogModel48,
  catalogModel49,
  catalogModel50,
  catalogModel51,
  catalogModel52,
  catalogModel53,
  catalogModel54,
  catalogModel55,
  catalogModel56,
  catalogModel57,
  catalogModel58,
  catalogModel59,
  catalogModel60,
  catalogModel61,
  catalogModel62,
  catalogModel63,
  catalogModel64,
  catalogModel65,
  catalogModel66,
  catalogModel67,
  catalogModel68,
  catalogModel69,
  catalogModel70,
  catalogModel71,
  catalogModel72,
  catalogModel73,
  catalogModel74,
  catalogModel75,
  catalogModel76,
  catalogModel77,
  catalogModel78,
  catalogModel79,
  catalogModel80,
  catalogModel81,
  catalogModel82,
  catalogModel83,
  catalogModel84,
  catalogModel85,
  catalogModel86,
  catalogModel87,
  catalogModel88,
  catalogModel89,
  catalogModel90,
  catalogModel91,
  catalogModel92,
  catalogModel93,
  catalogModel94,
  catalogModel95,
  catalogModel96,
  catalogModel97,
  catalogModel98,
  catalogModel99,
  catalogModel100,
  catalogModel101,
  catalogModel102,
  catalogModel103,
  catalogModel104,
  catalogModel105,
  catalogModel106,
  catalogModel107,
  catalogModel108,
  catalogModel109,
  catalogModel110,
  catalogModel111,
  catalogModel112,
  catalogModel113,
  catalogModel114,
  catalogModel115,
  catalogModel116,
  catalogModel117,
  catalogModel118,
  catalogModel119,
  catalogModel120,
  catalogModel121,
  catalogModel122,
  catalogModel123,
  catalogModel124,
] as const

export const catalogIndex = createModelIndex(catalog)
