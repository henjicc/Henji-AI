import { createModelIndex } from '@henjicc/ai-sdk'
import { HENJI_GENERATION_EXECUTION_PACKS } from '../../../src/core/modelCatalog/applicationModelProfile'
import { parseCanvasProjectRecord, type CanvasProjectJsonRecord } from '../../../src/core/canvas/projectRecordCodec'
import type { CanvasMediaSchemaResolver } from '../../../src/core/canvas/nodeMediaReferences'

// 只构建一次只读 metadata 索引，不创建生成 client、上传或执行模型。
const models = createModelIndex(HENJI_GENERATION_EXECUTION_PACKS.flatMap((pack) => pack.models))
export const resolveStoryboardProjectMediaSchema: CanvasMediaSchemaResolver = (id) => models.get(id)?.params

export function validateStoryboardProjectRecord(record: CanvasProjectJsonRecord): void {
  parseCanvasProjectRecord(record, resolveStoryboardProjectMediaSchema)
}
