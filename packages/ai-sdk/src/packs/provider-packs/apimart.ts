/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */
import model1 from '../../catalog/apimart/gemini-omni-flash.model'
import model2 from '../../catalog/apimart/gpt-image-2.model'
import model3 from '../../catalog/apimart/grok-imagine-2.0.model'
import model4 from '../../catalog/apimart/kling-3.0-omni.model'
import model5 from '../../catalog/apimart/kling-3.0-turbo.model'
import model6 from '../../catalog/apimart/kling-3.0.model'
import model7 from '../../catalog/apimart/midjourney-video.model'
import model8 from '../../catalog/apimart/midjourney.model'
import model9 from '../../catalog/apimart/minimax-h3.model'
import model10 from '../../catalog/apimart/nano-banana-2-lite.model'
import model11 from '../../catalog/apimart/nano-banana-2.model'
import model12 from '../../catalog/apimart/nano-banana-pro.model'
import model13 from '../../catalog/apimart/qwen-image-3.0.model'
import model14 from '../../catalog/apimart/seedance-2.0-fast.model'
import model15 from '../../catalog/apimart/seedance-2.0-mini.model'
import model16 from '../../catalog/apimart/seedance-2.0.model'
import model17 from '../../catalog/apimart/seedance-2.5.model'
import model18 from '../../catalog/apimart/seedream-5.0-lite.model'
import model19 from '../../catalog/apimart/seedream-5.0-pro.model'
import model20 from '../../catalog/apimart/z-image-turbo.model'
import { provider } from '../provider-adapters/apimart'
import type { GenerationPack } from '../../generation/core'

export const models = [model1, model2, model3, model4, model5, model6, model7, model8, model9, model10, model11, model12, model13, model14, model15, model16, model17, model18, model19, model20] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
