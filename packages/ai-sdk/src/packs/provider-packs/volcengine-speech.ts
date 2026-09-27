/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */
import model1 from '../../catalog/volcengine-speech/seed-icl-2.0.model'
import model2 from '../../catalog/volcengine-speech/seed-tts-2.0.model'
import { provider } from '../provider-adapters/volcengine-speech'
import type { GenerationPack } from '../../generation/core'

export const models = [model1, model2] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
