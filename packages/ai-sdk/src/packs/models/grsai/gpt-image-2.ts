/** 由 scripts/generate-catalog-index.cjs 自动生成；`pack` 是完整执行单元，`model` 仅供低层目录用途。 */
import model from '../../../catalog/grsai/gpt-image-2.model'
import * as adapter from '../../../providers/grsai'
import { preprocess } from '../../../upload/provider-preprocessors/data-uri'
import type { GenerationClientProviderRegistration, GenerationPack } from '../../../generation/core'

export { model }
export const provider: GenerationClientProviderRegistration = { id: 'grsai', adapter, preprocess }
export const pack: GenerationPack = { models: [model], providers: [provider] }
