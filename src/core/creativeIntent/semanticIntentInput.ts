import { z } from 'zod'
import type { DeixisResolution } from './deixis'
import { visualEvidenceSchema, type ExplanationSession, type VisualEvidence } from './schema'

/** Transfer budgets, not limits on the recording or its unresolved references. */
export const SEMANTIC_IMAGE_LONG_EDGE = 640
export const SEMANTIC_IMAGE_PIXEL_BUDGET = 2_500_000
export const semanticIntentImageSchema = z.object({
  mimeType: z.literal('image/jpeg'), data: z.string().min(1),
  manifest: visualEvidenceSchema,
}).strict()
export type SemanticIntentImage = z.infer<typeof semanticIntentImageSchema>

export function semanticVisualBatches(session: ExplanationSession, resolutions: readonly DeixisResolution[]): VisualEvidence[][] {
  const needed = new Set(resolutions.flatMap(r => r.mentions.flatMap(m => m.selected ? [] : m.candidates.flatMap(c => c.evidenceSeqs))))
  const appearance = resolutions.some(r => /颜色|样式|遮挡|构图|外观|草图/.test(r.text))
  // Split existing sheets into frame selections before applying request budgets.
  // The renderer crops each selection from the original managed pixels.
  const selections = session.visualEvidenceRefs.flatMap(v => v.frames.length > 1
    ? v.frames.map(frame => ({ ...v, kind: 'frame' as const, frames: [frame] })) : [v])
  const visuals = selections.filter(v => v.frames.some(f => needed.has(f.seq)
    || appearance && ['appearance', 'sketch', 'pointing', 'before', 'after', 'turn', 'reference'].includes(f.reason)))
    .sort((a, b) => a.frames[0].monoUs - b.frames[0].monoUs)
  const seen = new Set<string>()
  const unique = visuals.filter(v => {
    // Same pixels in another visit/time are different evidence and must survive.
    const key = JSON.stringify([v.resourceRef.digest, v.frames.map(f => [f.monoUs, f.timeline?.visitRef, f.stateDigest])])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  const batches: VisualEvidence[][] = []
  let batch: VisualEvidence[] = [], frames = 0
  for (const visual of unique) {
    if (batch.length && frames + visual.frames.length > 6) { batches.push(batch); batch = []; frames = 0 }
    batch.push(visual); frames += visual.frames.length
    if (frames >= 3 && frames !== 4 && frames !== 5) { batches.push(batch); batch = []; frames = 0 }
  }
  if (batch.length) batches.push(batch)
  return batches
}

export function scaleSemanticVisual(visual: VisualEvidence, width: number, height: number): VisualEvidence {
  if (width < 1 || height < 1 || width * height > SEMANTIC_IMAGE_PIXEL_BUDGET) throw new Error('附图尺寸超过工作预算。')
  const sx = width / visual.size[0], sy = height / visual.size[1]
  return visualEvidenceSchema.parse({ ...visual, size: [width, height], pixelBudget: SEMANTIC_IMAGE_PIXEL_BUDGET,
    frames: visual.frames.map(frame => ({ ...frame, attachmentRect: [frame.attachmentRect[0] * sx, frame.attachmentRect[1] * sy, frame.attachmentRect[2] * sx, frame.attachmentRect[3] * sy] })) })
}
