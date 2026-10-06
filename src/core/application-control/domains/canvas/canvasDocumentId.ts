import { z } from 'zod'

/**
 * 画布文档 ID（3.4 起画布是 `.henji-canvas` 文档）：取自 list_documents（kind=canvas）返回的 id，
 * 不是所在项目的 ID。画布各内容能力的 documentId 字段都用它（4.3 起字段统一叫 documentId，见 handlerUtils 的边界说明）。
 */
export const canvasDocumentIdSchema = z.string().min(1).describe('画布文档 ID：取自 list_documents（kind=canvas）返回的 id，不是所在项目的 ID。')
