import model from '../../../tool-packs/fal-image-utilities/models/photo-restoration.model'
import { provider } from '../../provider-adapters/fal'
import type { GenerationPack } from '../../../generation/core'

export { model, provider }
export const pack: GenerationPack = { models: [model], providers: [provider] }
