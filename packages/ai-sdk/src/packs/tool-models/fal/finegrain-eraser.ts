import model from '../../../tool-packs/fal-erase/models/finegrain-eraser.model'
import { provider } from '../../provider-adapters/fal'
import type { GenerationPack } from '../../../generation/core'

export { model, provider }
export const pack: GenerationPack = { models: [model], providers: [provider] }
