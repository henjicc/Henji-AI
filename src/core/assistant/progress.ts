import { z } from 'zod'

/** 宿主产生的业务指纹；不携带业务值，也不把传输编号当成进展。 */
export const progressEvidenceSchema = z.object({
  kind: z.enum(['observation', 'mutation', 'recovery']),
  subject: z.string().min(1).max(200),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export type ProgressEvidence = z.infer<typeof progressEvidenceSchema>
