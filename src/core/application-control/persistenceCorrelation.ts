import { z } from 'zod'
import { applicationRefSchema } from './identifiers'

/** 随领域保存边界传递的执行关联，不携带业务快照或属性 schema。 */
export const applicationPersistenceCorrelationSchema = z.object({
  operationId: z.string().min(1).max(500),
  boundaryId: z.string().min(1).max(500),
  targets: z.array(applicationRefSchema).max(65_536),
}).strict()
export type ApplicationPersistenceCorrelation = z.infer<typeof applicationPersistenceCorrelationSchema>

/** 可由 SQLite 事务或领域原子文件证明的保存边界回执。 */
export const applicationPersistenceReceiptSchema = applicationPersistenceCorrelationSchema.extend({
  persistedAt: z.string().datetime(), storageTarget: applicationRefSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type ApplicationPersistenceReceiptRecord = z.infer<typeof applicationPersistenceReceiptSchema>
