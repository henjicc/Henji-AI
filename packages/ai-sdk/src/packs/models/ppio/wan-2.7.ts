/** 由 scripts/generate-catalog-index.cjs 自动生成；`pack` 是完整执行单元，`model` 仅供低层目录用途。 */
import model from '../../../catalog/ppio/wan-2.7.model'
import * as adapter from '../../../providers/ppio'
import { preprocess } from '../../../upload/provider-preprocessors/ppio'
import type { GenerationClientProviderRegistration, GenerationPack } from '../../../generation/core'

export { model }
export const provider: GenerationClientProviderRegistration = { id: 'ppio', adapter, preprocess }
export const pack: GenerationPack = { models: [model], providers: [provider] }
