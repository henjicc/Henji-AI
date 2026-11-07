/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */
import model1 from '../../catalog/volcengine/seedance-2.0-fast.model'
import model2 from '../../catalog/volcengine/seedance-2.0-mini.model'
import model3 from '../../catalog/volcengine/seedance-2.0.model'
import model4 from '../../catalog/volcengine/seedance-2.5.model'
import model5 from '../../catalog/volcengine/seedream-5.0-flash.model'
import model6 from '../../catalog/volcengine/seedream-5.0-lite.model'
import model7 from '../../catalog/volcengine/seedream-5.0-pro.model'
import { provider } from '../provider-adapters/volcengine'
import type { GenerationPack } from '../../generation/core'

export const models = [model1, model2, model3, model4, model5, model6, model7] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
