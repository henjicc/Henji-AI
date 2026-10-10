import { z } from 'zod'
import { affineSchema, candidateIdentitySchema, digestSchema, sampleSchema, type CandidateIdentity } from '../../creativeIntent/contracts'
import { layoutItemSchema, type LayoutCandidate } from '../../creativeIntent/layout'
import { applicationRefSchema } from '../../application-control/identifiers'
import { composeAffine, inverseAffine, translateAffine, type Affine } from '../../imaging/transforms'

/** Immutable, bounded pages preserve complete affine geometry alongside the shared semantic sample. */
export const imageLayoutEntrySchema = z.object({
  layerId: z.string().min(1), sample: sampleSchema, item: layoutItemSchema,
  localAffine: affineSchema, parentAffine: affineSchema,
}).strict()
export type ImageLayoutEntry = z.infer<typeof imageLayoutEntrySchema>
export const imageLayoutPageSchema = z.object({ version: z.literal(1), kind: z.literal('image-layout'),
  ownerRef: applicationRefSchema, sourceDigest: digestSchema, baseDigest: digestSchema, entries: z.array(imageLayoutEntrySchema).min(1),
}).strict()
export const imageLayoutCandidateSchema = z.object({ version: z.literal(1), id: z.string().min(1), label: z.string(),
  identity: candidateIdentitySchema, changes: z.array(z.object({ targetRef: applicationRefSchema, affine: affineSchema,
    delta: z.tuple([z.number().finite(), z.number().finite()]) }).strict()), maxConstraintError: z.number().finite().nonnegative(),
}).strict()

export function imageLayoutLocalChanges(entries: readonly ImageLayoutEntry[], candidate: LayoutCandidate): { layerId: string; transform: Affine }[] {
  const byRef = new Map(entries.map(e => [JSON.stringify([e.item.targetRef.kind, e.item.targetRef.id]), e]))
  if (candidate.changes.length !== entries.length) throw new Error('布局候选目标已变化，请重新整理')
  const seen = new Set<string>()
  return candidate.changes.flatMap(change => {
    const key = JSON.stringify([change.targetRef.kind, change.targetRef.id]), entry = byRef.get(key)
    if (!entry || seen.has(key)) throw new Error('布局候选目标不符，请重新整理')
    seen.add(key)
    inverseAffine(entry.parentAffine); inverseAffine(entry.localAffine)
    if(composeAffine(entry.parentAffine,entry.localAffine).some((v,i)=>Math.abs(v-entry.item.affine[i])>1e-8))throw new Error('原稿完整变换与父坐标不符')
    const expected = translateAffine(entry.item.affine, change.delta)
    if (expected.some((v, i) => Math.abs(v - change.affine[i]) > 1e-8)
      || entry.item.translationLocked && change.delta.some(v => v !== 0)) throw new Error('布局候选改变了钉住姿态或完整变换')
    if (change.delta.every(v => v === 0)) return []
    // Inverse linear mapping only: keep a/b/c/d bit-for-bit, including reflection, shear and nonuniform scales.
    const inv = inverseAffine(entry.parentAffine)
    const transform = translateAffine(entry.localAffine, [inv[0] * change.delta[0] + inv[2] * change.delta[1], inv[1] * change.delta[0] + inv[3] * change.delta[1]])
    const world = composeAffine(entry.parentAffine, transform)
    if (world.some((v, i) => Math.abs(v - change.affine[i]) > 1e-7)) throw new Error('布局坐标反求失败，请重新整理')
    return [{ layerId: entry.layerId, transform }]
  })
}

export function imageLayoutIdentity(sourceDraftDigest: string, ownerRef: CandidateIdentity['ownerRef'], bases: CandidateIdentity['targetBases'], fidelity: number): CandidateIdentity {
  return { sourceDraftDigest, ownerRef, targetBases: bases, algorithmVersion: 'image-layout/1', requestKey: `layout:${fidelity}` }
}
