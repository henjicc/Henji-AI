/** 由 scripts/generate-catalog-index.cjs 自动生成；不静态导入任何模型。 */
import * as adapter from '../../providers/modelscope'
import { preprocess } from '../../upload/provider-preprocessors/kie'
import type { GenerationClientProviderRegistration } from '../../generation/core'

export const provider: GenerationClientProviderRegistration = { id: 'modelscope', adapter, preprocess }
export default provider
