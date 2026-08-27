/** 由 scripts/generate-catalog-index.cjs 自动生成；`pack` 是完整执行单元，`model` 仅供低层目录用途。 */
import model from '../../../catalog/apimart/kling-3.0-turbo.model'
import * as adapter from '../../../providers/apimart'
import { preprocess } from '../../../upload/provider-preprocessors/apimart'
import type { GenerationClientProviderRegistration, GenerationPack } from '../../../generation/core'

export { model }
export const provider: GenerationClientProviderRegistration = { id: 'apimart', adapter, preprocess }
export const pack: GenerationPack = { models: [model], providers: [provider] }
