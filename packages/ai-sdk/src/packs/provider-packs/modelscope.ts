/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */
import model1 from '../../catalog/modelscope/flux-1-krea-dev.model'
import model2 from '../../catalog/modelscope/majicmix-realistic.model'
import model3 from '../../catalog/modelscope/modelscope-custom.model'
import model4 from '../../catalog/modelscope/qwen-image-edit-2509.model'
import model5 from '../../catalog/modelscope/qwen-image.model'
import model6 from '../../catalog/modelscope/sdxl-14-ckpt.model'
import model7 from '../../catalog/modelscope/z-image-turbo.model'
import { provider } from '../provider-adapters/modelscope'
import type { GenerationPack } from '../../generation/core'

export const models = [model1, model2, model3, model4, model5, model6, model7] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
