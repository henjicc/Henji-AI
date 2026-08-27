/** 由 scripts/generate-catalog-index.cjs 自动生成；不静态导入任何模型。 */
import * as adapter from '../../providers/fal'
import { preprocess } from '../../upload/provider-preprocessors/fal'
import type { GenerationClientProviderRegistration } from '../../generation/core'

export const provider: GenerationClientProviderRegistration = { id: 'fal', adapter, preprocess }
export default provider
