/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */
import model1 from '../../catalog/volcengine/seedream-5.0-lite.model'
import model2 from '../../catalog/volcengine/seedream-5.0-pro.model'
import { provider } from '../provider-adapters/volcengine'
import type { GenerationPack } from '../../generation/core'

export const models = [model1, model2] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
