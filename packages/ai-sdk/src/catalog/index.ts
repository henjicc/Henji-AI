/**
 * 由 scripts/generate-catalog-index.cjs 自动生成。
 * 显式导入保证 catalog 不依赖 Vite 专有目录扫描，可被 UXP/Tauri/Node 打包器消费。
 */

import type { ModelRuntimeDefinition } from '../types/model'
import { createModelIndex } from './model-index'
import catalogModel1 from './apimart/flux-3-image.model'
import catalogModel2 from './apimart/flux-3-video.model'
import catalogModel3 from './apimart/gemini-omni-1.2-flash.model'
import catalogModel4 from './apimart/gemini-omni-flash.model'
import catalogModel5 from './apimart/gpt-image-2.5.model'
import catalogModel6 from './apimart/gpt-image-2.6.model'
import catalogModel7 from './apimart/gpt-image-2.model'
import catalogModel8 from './apimart/grok-imagine-2.0.model'
import catalogModel9 from './apimart/grok-imagine-video-1.5.model'
import catalogModel10 from './apimart/happyhorse-1.1.model'
import catalogModel11 from './apimart/kling-3.0-omni.model'
import catalogModel12 from './apimart/kling-3.0-turbo.model'
import catalogModel13 from './apimart/kling-3.0.model'
import catalogModel14 from './apimart/kling-4.0.model'
import catalogModel15 from './apimart/midjourney-video.model'
import catalogModel16 from './apimart/midjourney.model'
import catalogModel17 from './apimart/minimax-h3-image.model'
import catalogModel18 from './apimart/minimax-h3-max.model'
import catalogModel19 from './apimart/minimax-h3.model'
import catalogModel20 from './apimart/nano-banana-2-lite.model'
import catalogModel21 from './apimart/nano-banana-2.1.model'
import catalogModel22 from './apimart/nano-banana-2.model'
import catalogModel23 from './apimart/nano-banana-pro.model'
import catalogModel24 from './apimart/qwen-image-3.0.model'
import catalogModel25 from './apimart/seedance-2.0-fast.model'
import catalogModel26 from './apimart/seedance-2.0-mini.model'
import catalogModel27 from './apimart/seedance-2.0.model'
import catalogModel28 from './apimart/seedance-2.5.model'
import catalogModel29 from './apimart/seedream-5.0-flash.model'
import catalogModel30 from './apimart/seedream-5.0-lite.model'
import catalogModel31 from './apimart/seedream-5.0-pro.model'
import catalogModel32 from './apimart/veo-3.1.model'
import catalogModel33 from './apimart/wan-2.7-image.model'
import catalogModel34 from './apimart/wan-3.0.model'
import catalogModel35 from './apimart/z-image-turbo.model'
import catalogModel36 from './bailian/cosyvoice-v3.5.model'
import catalogModel37 from './bailian/minimax-h3.model'
import catalogModel38 from './bailian/minimax-speech-2.8.model'
import catalogModel39 from './bailian/qwen-audio-3.1-tts-flash.model'
import catalogModel40 from './bailian/qwen-audio-3.1-tts-plus.model'
import catalogModel41 from './bailian/qwen-image-2.1.model'
import catalogModel42 from './bailian/qwen-image-3.0.model'
import catalogModel43 from './bailian/wan-3.0.model'
import catalogModel44 from './bailian/z-image-turbo.model'
import catalogModel45 from './deepseek/deepseek-tts.model'
import catalogModel46 from './fal/bria-creative-upscale.model'
import catalogModel47 from './fal/eleven-v3-tts.model'
import catalogModel48 from './fal/eleven-v4-tts.model'
import catalogModel49 from './fal/flux-3-video.model'
import catalogModel50 from './fal/flux-3.model'
import catalogModel51 from './fal/gemini-omni-1.2-flash.model'
import catalogModel52 from './fal/gemini-omni-flash.model'
import catalogModel53 from './fal/gpt-image-2.5.model'
import catalogModel54 from './fal/gpt-image-2.6.model'
import catalogModel55 from './fal/gpt-image-2.model'
import catalogModel56 from './fal/grok-imagine-2.0.model'
import catalogModel57 from './fal/grok-imagine-video-1.5.model'
import catalogModel58 from './fal/hailuo-02.model'
import catalogModel59 from './fal/hailuo-2.3.model'
import catalogModel60 from './fal/ic-light-v2.model'
import catalogModel61 from './fal/ideogram-upscale.model'
import catalogModel62 from './fal/kling-3.0-omni.model'
import catalogModel63 from './fal/kling-3.0-turbo.model'
import catalogModel64 from './fal/kling-3.0.model'
import catalogModel65 from './fal/kling-4.0-flash.model'
import catalogModel66 from './fal/kling-4.0.model'
import catalogModel67 from './fal/kling-image-o1.model'
import catalogModel68 from './fal/kling-video-o1.model'
import catalogModel69 from './fal/kling-video-v2.6-pro.model'
import catalogModel70 from './fal/ltx-2.3.model'
import catalogModel71 from './fal/ltx-2.5.model'
import catalogModel72 from './fal/ltx-2.model'
import catalogModel73 from './fal/minimax-h3-image.model'
import catalogModel74 from './fal/minimax-h3-max.model'
import catalogModel75 from './fal/minimax-h3.model'
import catalogModel76 from './fal/minimax-speech-2.8.model'
import catalogModel77 from './fal/nano-banana-2.1.model'
import catalogModel78 from './fal/nano-banana-2.model'
import catalogModel79 from './fal/nano-banana-pro.model'
import catalogModel80 from './fal/nano-banana.model'
import catalogModel81 from './fal/pixverse-v5.5.model'
import catalogModel82 from './fal/pixverse-v6.model'
import catalogModel83 from './fal/qwen-image-3.0.model'
import catalogModel84 from './fal/qwen3-tts-1.7b.model'
import catalogModel85 from './fal/seedance-2.0-fast.model'
import catalogModel86 from './fal/seedance-2.0-mini.model'
import catalogModel87 from './fal/seedance-2.0.model'
import catalogModel88 from './fal/seedance-2.5.model'
import catalogModel89 from './fal/seedance.model'
import catalogModel90 from './fal/seedream-5.0-lite.model'
import catalogModel91 from './fal/seedream-5.0-pro.model'
import catalogModel92 from './fal/seedream-5.5.model'
import catalogModel93 from './fal/seedream-v4.5.model'
import catalogModel94 from './fal/seedream-v4.model'
import catalogModel95 from './fal/seedvr2-image-upscale.model'
import catalogModel96 from './fal/topaz-image-upscale.model'
import catalogModel97 from './fal/topaz-transparent-upscale.model'
import catalogModel98 from './fal/veo-3.1.model'
import catalogModel99 from './fal/vidu-q2.model'
import catalogModel100 from './fal/wan-2.5-preview.model'
import catalogModel101 from './fal/wan-3.0.model'
import catalogModel102 from './fal/z-image-turbo.model'
import catalogModel103 from './grsai/gpt-image-2.5.model'
import catalogModel104 from './grsai/gpt-image-2.6.model'
import catalogModel105 from './grsai/gpt-image-2.model'
import catalogModel106 from './grsai/nano-banana-2-lite.model'
import catalogModel107 from './grsai/nano-banana-2.1.model'
import catalogModel108 from './grsai/nano-banana-2.model'
import catalogModel109 from './grsai/nano-banana-pro.model'
import catalogModel110 from './grsai/wan-3.0.model'
import catalogModel111 from './kie/eleven-v3-dialogue.model'
import catalogModel112 from './kie/flux-3-klein.model'
import catalogModel113 from './kie/gemini-3.1-flash-tts.model'
import catalogModel114 from './kie/gemini-3.8-flash-lite-tts.model'
import catalogModel115 from './kie/gemini-3.8-flash-tts.model'
import catalogModel116 from './kie/gemini-omni-video.model'
import catalogModel117 from './kie/gpt-image-2.5.model'
import catalogModel118 from './kie/gpt-image-2.6.model'
import catalogModel119 from './kie/gpt-image-2.model'
import catalogModel120 from './kie/grok-imagine-2.0.model'
import catalogModel121 from './kie/grok-imagine-video-1.5.model'
import catalogModel122 from './kie/grok-imagine-video.model'
import catalogModel123 from './kie/grok-imagine.model'
import catalogModel124 from './kie/hailuo-02.model'
import catalogModel125 from './kie/hailuo-2-3.model'
import catalogModel126 from './kie/happyhorse-1.1.model'
import catalogModel127 from './kie/kling-3.0-omni.model'
import catalogModel128 from './kie/kling-3.0-turbo.model'
import catalogModel129 from './kie/kling-3.0.model'
import catalogModel130 from './kie/kling-4.0-flash.model'
import catalogModel131 from './kie/kling-4.0.model'
import catalogModel132 from './kie/kling-v2-6.model'
import catalogModel133 from './kie/minimax-h3-image.model'
import catalogModel134 from './kie/minimax-h3.model'
import catalogModel135 from './kie/nano-banana-2-lite.model'
import catalogModel136 from './kie/nano-banana-2.1.model'
import catalogModel137 from './kie/nano-banana-2.model'
import catalogModel138 from './kie/nano-banana-pro.model'
import catalogModel139 from './kie/qwen-image-3.0.model'
import catalogModel140 from './kie/seedance-1.5-pro.model'
import catalogModel141 from './kie/seedance-2.0-fast.model'
import catalogModel142 from './kie/seedance-2.0-mini.model'
import catalogModel143 from './kie/seedance-2.0.model'
import catalogModel144 from './kie/seedance-2.5.model'
import catalogModel145 from './kie/seedance-v1.model'
import catalogModel146 from './kie/seedream-4.0.model'
import catalogModel147 from './kie/seedream-4.5.model'
import catalogModel148 from './kie/seedream-5.0-lite.model'
import catalogModel149 from './kie/seedream-5.0-pro.model'
import catalogModel150 from './kie/seedream-5.5.model'
import catalogModel151 from './kie/wan-3.0-prime.model'
import catalogModel152 from './kie/wan-3.0.model'
import catalogModel153 from './kie/z-image.model'
import catalogModel154 from './modelscope/flux-1-krea-dev.model'
import catalogModel155 from './modelscope/majicmix-realistic.model'
import catalogModel156 from './modelscope/modelscope-custom.model'
import catalogModel157 from './modelscope/qwen-image-2512.model'
import catalogModel158 from './modelscope/qwen-image-edit-2511.model'
import catalogModel159 from './modelscope/sdxl-14-ckpt.model'
import catalogModel160 from './modelscope/z-image-turbo.model'
import catalogModel161 from './ppio/kling-3.0.model'
import catalogModel162 from './ppio/minimax-speech.model'
import catalogModel163 from './siliconflow/cosyvoice2-tts.model'
import catalogModel164 from './siliconflow/moss-ttsd-0.5.model'
import catalogModel165 from './volcengine-speech/seed-icl-2.0.model'
import catalogModel166 from './volcengine-speech/seed-tts-2.0.model'
import catalogModel167 from './volcengine/seedance-2.0-fast.model'
import catalogModel168 from './volcengine/seedance-2.0-mini.model'
import catalogModel169 from './volcengine/seedance-2.0.model'
import catalogModel170 from './volcengine/seedance-2.5.model'
import catalogModel171 from './volcengine/seedream-5.0-flash.model'
import catalogModel172 from './volcengine/seedream-5.0-lite.model'
import catalogModel173 from './volcengine/seedream-5.0-pro.model'
import catalogModel174 from './volcengine/seedream-5.5.model'

export * from './defineModel'
export * from './model-index'
export * from './validate'
export * from './conditions'
export * from './consumer-contract'
export * from './continuation'
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
  catalogModel125,
  catalogModel126,
  catalogModel127,
  catalogModel128,
  catalogModel129,
  catalogModel130,
  catalogModel131,
  catalogModel132,
  catalogModel133,
  catalogModel134,
  catalogModel135,
  catalogModel136,
  catalogModel137,
  catalogModel138,
  catalogModel139,
  catalogModel140,
  catalogModel141,
  catalogModel142,
  catalogModel143,
  catalogModel144,
  catalogModel145,
  catalogModel146,
  catalogModel147,
  catalogModel148,
  catalogModel149,
  catalogModel150,
  catalogModel151,
  catalogModel152,
  catalogModel153,
  catalogModel154,
  catalogModel155,
  catalogModel156,
  catalogModel157,
  catalogModel158,
  catalogModel159,
  catalogModel160,
  catalogModel161,
  catalogModel162,
  catalogModel163,
  catalogModel164,
  catalogModel165,
  catalogModel166,
  catalogModel167,
  catalogModel168,
  catalogModel169,
  catalogModel170,
  catalogModel171,
  catalogModel172,
  catalogModel173,
  catalogModel174,
] as const

export const catalogIndex = createModelIndex(catalog)
