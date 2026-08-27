/** 由 scripts/generate-catalog-index.cjs 自动生成；`pack` 是完整执行单元，`model` 仅供低层目录用途。 */
import model from '../../../catalog/fal/seedream-5.0-pro.model'
import * as adapter from '../../../providers/fal'
import { preprocess } from '../../../upload/provider-preprocessors/fal'
import type { GenerationClientProviderRegistration, GenerationPack } from '../../../generation/core'

export { model }
export const provider: GenerationClientProviderRegistration = { id: 'fal', adapter, preprocess }
export const pack: GenerationPack = { models: [model], providers: [provider] }
