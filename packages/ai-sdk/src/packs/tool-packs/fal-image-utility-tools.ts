import relighting from '../../tool-packs/fal-image-utilities/models/relighting.model'
import controlLight from '../../tool-packs/fal-image-utilities/models/control-light.model'
import outpaint from '../../tool-packs/fal-image-utilities/models/outpaint.model'
import productPhotography from '../../tool-packs/fal-image-utilities/models/product-photography.model'
import photoRestoration from '../../tool-packs/fal-image-utilities/models/photo-restoration.model'
import pixelcutBackgroundRemoval from '../../tool-packs/fal-image-utilities/models/pixelcut-background-removal.model'
import { provider } from '../provider-adapters/fal'
import type { GenerationPack } from '../../generation/core'

/** 按需分发集合：Fal 单图重打光、修复、扩图、商品摄影与背景移除工具。 */
export const models = [
  relighting,
  controlLight,
  outpaint,
  productPhotography,
  photoRestoration,
  pixelcutBackgroundRemoval,
] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
