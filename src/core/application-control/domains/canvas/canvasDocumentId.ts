import { z } from 'zod'

/**
 * 画布文档 ID（3.4 起画布是 `.henji-canvas` 文档）：取自 list_documents（kind=canvas）返回的 id，
 * 不是所在项目的 ID。画布各内容能力的 projectId 字段都用它（字段名保留 projectId，4.3 统一叫法时再改）。
 */
export const canvasDocumentIdSchema = z.string().min(1).describe('画布文档 ID：取自 list_documents（kind=canvas）返回的 id，不是所在项目的 ID。')
