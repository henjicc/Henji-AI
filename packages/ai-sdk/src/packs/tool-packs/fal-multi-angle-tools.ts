import flux2MultipleAngles from '../../tool-packs/fal-multi-angle/models/flux-2-multiple-angles.model'
import perspectiveChange from '../../tool-packs/fal-multi-angle/models/perspective-change.model'
import qwenMultipleAngles from '../../tool-packs/fal-multi-angle/models/qwen-image-edit-2509-multiple-angles.model'
import { provider } from '../provider-adapters/fal'
import type { GenerationPack } from '../../generation/core'

/** 按需分发集合：只聚合多角度能力的三个 Fal 工具模型。 */
export const models = [qwenMultipleAngles, perspectiveChange, flux2MultipleAngles] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
