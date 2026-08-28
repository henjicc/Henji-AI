import model from '../../../tool-packs/fal-multi-angle/models/qwen-image-edit-2509-multiple-angles.model'
import { provider } from '../../provider-adapters/fal'
import type { GenerationPack } from '../../../generation/core'

export { model, provider }
export const pack: GenerationPack = { models: [model], providers: [provider] }
