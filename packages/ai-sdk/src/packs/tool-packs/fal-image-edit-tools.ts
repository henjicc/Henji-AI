import briaEraser from '../../tool-packs/fal-erase/models/bria-eraser.model'
import finegrainEraser from '../../tool-packs/fal-erase/models/finegrain-eraser.model'
import fluxProErase from '../../tool-packs/fal-erase/models/flux-pro-erase.model'
import { provider } from '../provider-adapters/fal'
import type { GenerationPack } from '../../generation/core'

/** 技术分发集合：只聚合 Photoshop 当前选择的 3 个 Fal 图片编辑工具模型。 */
export const models = [fluxProErase, briaEraser, finegrainEraser] as const
export const pack: GenerationPack = { models, providers: [provider] }
export default pack
