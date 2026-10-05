import { createModelIndex } from '@henjicc/ai-sdk'
import { HENJI_GENERATION_EXECUTION_PACKS } from '../../../src/core/modelCatalog/applicationModelProfile'
import type { CanvasMediaSchemaResolver } from '../../../src/core/canvas/nodeMediaReferences'

/*
 * 主进程读画布文档节点里的媒体字段时用的模型参数表（与渲染层 resolveCanvasNodeMediaSchema 规则一致，
 * 见 src/core/canvas/projectMediaSchemaParity.test.ts）。只构建一次只读 metadata 索引，不创建生成 client。
 */
const models = createModelIndex(HENJI_GENERATION_EXECUTION_PACKS.flatMap((pack) => pack.models))
export const resolveCanvasMediaSchema: CanvasMediaSchemaResolver = (id) => models.get(id)?.params
