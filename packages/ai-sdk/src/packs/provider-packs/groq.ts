/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */
import model1 from '../../catalog/groq/orpheus-arabic-saudi.model'
import model2 from '../../catalog/groq/orpheus-v1-english.model'
import { provider } from '../provider-adapters/groq'
import type { GenerationPack } from '../../generation/core'

export const models = [model1, model2] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
