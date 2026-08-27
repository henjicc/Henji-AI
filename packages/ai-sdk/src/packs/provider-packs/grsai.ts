/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */
import model1 from '../../catalog/grsai/gpt-image-2.model'
import model2 from '../../catalog/grsai/nano-banana-2-lite.model'
import model3 from '../../catalog/grsai/nano-banana-2.model'
import model4 from '../../catalog/grsai/nano-banana-pro.model'
import { provider } from '../provider-adapters/grsai'
import type { GenerationPack } from '../../generation/core'

export const models = [model1, model2, model3, model4] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
