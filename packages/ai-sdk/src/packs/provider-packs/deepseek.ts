/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */
import model1 from '../../catalog/deepseek/deepseek-tts.model'
import { provider } from '../provider-adapters/deepseek'
import type { GenerationPack } from '../../generation/core'

export const models = [model1] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
