/**
 * 由 scripts/generate-catalog-index.cjs 自动生成。
 * 显式导入保证 catalog 不依赖 Vite 专有目录扫描，可被 UXP/Tauri/Node 打包器消费。
 */

import type { ModelRuntimeDefinition } from '../types/model'
import { createModelIndex } from './model-index'
import catalogModel1 from './apimart/gemini-omni-flash.model'
import catalogModel2 from './apimart/gpt-image-2.model'
import catalogModel3 from './apimart/grok-imagine-2.0.model'
import catalogModel4 from './apimart/kling-3.0-omni.model'
import catalogModel5 from './apimart/kling-3.0-turbo.model'
import catalogModel6 from './apimart/kling-3.0.model'
import catalogModel7 from './apimart/midjourney-video.model'
import catalogModel8 from './apimart/midjourney.model'
import catalogModel9 from './apimart/minimax-h3.model'
import catalogModel10 from './apimart/nano-banana-2-lite.model'
import catalogModel11 from './apimart/nano-banana-2.model'
import catalogModel12 from './apimart/nano-banana-pro.model'
import catalogModel13 from './apimart/qwen-image-3.0.model'
import catalogModel14 from './apimart/seedance-2.0-fast.model'
import catalogModel15 from './apimart/seedance-2.0-mini.model'
import catalogModel16 from './apimart/seedance-2.0.model'
import catalogModel17 from './apimart/seedance-2.5.model'
import catalogModel18 from './apimart/seedream-5.0-lite.model'
import catalogModel19 from './apimart/seedream-5.0-pro.model'
import catalogModel20 from './apimart/z-image-turbo.model'
import catalogModel21 from './bailian/qwen-image-3.0.model'
import catalogModel22 from './bailian/z-image-turbo.model'
import catalogModel23 from './fal/bria-creative-upscale.model'
import catalogModel24 from './fal/gemini-omni-flash.model'
import catalogModel25 from './fal/gpt-image-2.model'
import catalogModel26 from './fal/grok-imagine-2.0.model'
import catalogModel27 from './fal/hailuo-02.model'
import catalogModel28 from './fal/hailuo-2.3.model'
import catalogModel29 from './fal/ic-light-v2.model'
import catalogModel30 from './fal/ideogram-upscale.model'
import catalogModel31 from './fal/kling-3.0-omni.model'
import catalogModel32 from './fal/kling-3.0-turbo.model'
import catalogModel33 from './fal/kling-3.0.model'
import catalogModel34 from './fal/kling-image-o1.model'
import catalogModel35 from './fal/kling-video-o1.model'
import catalogModel36 from './fal/kling-video-v2.6-pro.model'
import catalogModel37 from './fal/ltx-2.model'
import catalogModel38 from './fal/minimax-h3.model'
import catalogModel39 from './fal/nano-banana-2.model'
import catalogModel40 from './fal/nano-banana-pro.model'
import catalogModel41 from './fal/nano-banana.model'
import catalogModel42 from './fal/pixverse-v5.5.model'
import catalogModel43 from './fal/qwen-image-3.0.model'
import catalogModel44 from './fal/seedance-2.0-fast.model'
import catalogModel45 from './fal/seedance-2.0-mini.model'
import catalogModel46 from './fal/seedance-2.0.model'
import catalogModel47 from './fal/seedance-2.5.model'
import catalogModel48 from './fal/seedance.model'
import catalogModel49 from './fal/seedream-5.0-lite.model'
import catalogModel50 from './fal/seedream-5.0-pro.model'
import catalogModel51 from './fal/seedream-v4.5.model'
import catalogModel52 from './fal/seedream-v4.model'
import catalogModel53 from './fal/seedvr2-image-upscale.model'
import catalogModel54 from './fal/topaz-image-upscale.model'
import catalogModel55 from './fal/topaz-transparent-upscale.model'
import catalogModel56 from './fal/veo-3.1.model'
import catalogModel57 from './fal/vidu-q2.model'
import catalogModel58 from './fal/wan-2.5-preview.model'
import catalogModel59 from './fal/z-image-turbo.model'
import catalogModel60 from './grsai/gpt-image-2.model'
import catalogModel61 from './grsai/nano-banana-2-lite.model'
import catalogModel62 from './grsai/nano-banana-2.model'
import catalogModel63 from './grsai/nano-banana-pro.model'
import catalogModel64 from './kie/gemini-omni-video.model'
import catalogModel65 from './kie/gpt-image-2.model'
import catalogModel66 from './kie/grok-imagine-2.0.model'
import catalogModel67 from './kie/grok-imagine-video.model'
import catalogModel68 from './kie/grok-imagine.model'
import catalogModel69 from './kie/hailuo-02.model'
import catalogModel70 from './kie/hailuo-2-3.model'
import catalogModel71 from './kie/kling-3.0-omni.model'
import catalogModel72 from './kie/kling-3.0-turbo.model'
import catalogModel73 from './kie/kling-3.0.model'
import catalogModel74 from './kie/kling-v2-6.model'
import catalogModel75 from './kie/minimax-h3.model'
import catalogModel76 from './kie/nano-banana-2-lite.model'
import catalogModel77 from './kie/nano-banana-2.model'
import catalogModel78 from './kie/nano-banana-pro.model'
import catalogModel79 from './kie/qwen-image-3.0.model'
import catalogModel80 from './kie/seedance-1.5-pro.model'
import catalogModel81 from './kie/seedance-2.0-fast.model'
import catalogModel82 from './kie/seedance-2.0-mini.model'
import catalogModel83 from './kie/seedance-2.0.model'
import catalogModel84 from './kie/seedance-2.5.model'
import catalogModel85 from './kie/seedance-v1.model'
import catalogModel86 from './kie/seedream-4.0.model'
import catalogModel87 from './kie/seedream-4.5.model'
import catalogModel88 from './kie/seedream-5.0-lite.model'
import catalogModel89 from './kie/seedream-5.0-pro.model'
import catalogModel90 from './kie/z-image.model'
import catalogModel91 from './modelscope/flux-1-krea-dev.model'
import catalogModel92 from './modelscope/majicmix-realistic.model'
import catalogModel93 from './modelscope/modelscope-custom.model'
import catalogModel94 from './modelscope/qwen-image-edit-2509.model'
import catalogModel95 from './modelscope/qwen-image.model'
import catalogModel96 from './modelscope/sdxl-14-ckpt.model'
import catalogModel97 from './modelscope/z-image-turbo.model'
import catalogModel98 from './ppio/kling-3.0.model'
import catalogModel99 from './ppio/minimax-hailuo-2.3.model'
import catalogModel100 from './ppio/minimax-speech.model'
import catalogModel101 from './ppio/wan-2.5-preview.model'
import catalogModel102 from './ppio/wan-2.6.model'
import catalogModel103 from './ppio/wan-2.7.model'
import catalogModel104 from './volcengine/seedream-5.0-lite.model'
import catalogModel105 from './volcengine/seedream-5.0-pro.model'

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
] as const

export const catalogIndex = createModelIndex(catalog)
