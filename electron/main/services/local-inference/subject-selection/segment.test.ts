import { describe, expect, it } from 'vitest'
import { subjectCandidate, distinctSubjectCandidates, portraitCandidates, runImageSubjectSelection } from './segment'
import type { LocalTensorOutput, LocalModelRunner, LocalTensorInput } from '../analysis'
import type { ImageSubjectSelectionJob } from './protocol'

describe('主体候选与静态推理契约', () => {
  it('重叠候选消重，分开的人像仍返回各自软边，不限制候选数量', () => {
    const a = subjectCandidate(Uint8Array.of(255, 255, 0, 0), 4, 1, 0.9)!, b = subjectCandidate(Uint8Array.of(255, 255, 0, 0), 4, 1, 0.5)!, c = subjectCandidate(Uint8Array.of(0, 0, 255, 255), 4, 1, 0.8)!
    expect(distinctSubjectCandidates([b, c, a])).toHaveLength(2)
    expect(portraitCandidates(Uint8Array.of(255, 128, 0, 0, 128, 255), 6, 1)).toHaveLength(2)
  })
  it('静态点选只打开两件模型，坐标及负点进解码器；透明像素不进入选区', async () => {
    const opened: string[] = [], feeds: Readonly<Record<string, LocalTensorInput>>[] = []
    const logits = new Float32Array(128 * 128).fill(1)
    const runner = (name: string): LocalModelRunner => ({ provider: 'cpu', run: async (input): Promise<Record<string, LocalTensorOutput>> => {
      feeds.push(input)
      return name === 'etam_image_encoder' ? { vision_feat: { data: new Float32Array(256 * 32 * 32), dims: [1, 256, 32, 32] }, vision_feat_nomem: { data: new Float32Array(256 * 32 * 32), dims: [1, 256, 32, 32] } }
        : { mask_logits: { data: logits, dims: [1, 1, 128, 128] }, object_score_logits: { data: Float32Array.of(1), dims: [1, 1] }, obj_ptr: { data: new Float32Array(256), dims: [1, 256] }, iou_scores: { data: Float32Array.of(1, 0.8, 0.7, 0.6), dims: [1, 4] } }
    } })
    const job: ImageSubjectSelectionJob = { id: 'point', width: 2, height: 2, rgba: Uint8Array.of(20, 30, 40, 255, 20, 30, 40, 0, 20, 30, 40, 255, 20, 30, 40, 0).buffer,
      region: { kind: 'point', points: [{ x: 0.25, y: 0.5, foreground: true }, { x: 0.75, y: 0.5, foreground: false }] }, providers: ['cpu'], models: [{ name: 'etam_image_encoder', path: 'encoder' }, { name: 'etam_mask_decoder', path: 'decoder' }] }
    const result = await runImageSubjectSelection(job, { openModel: async model => { opened.push(model.name); return runner(model.name) }, signal: new AbortController().signal, log: () => undefined, progress: () => undefined })
    expect(opened).toEqual(['etam_image_encoder', 'etam_mask_decoder']); expect([...feeds[1].point_coords.data]).toEqual([128, 256, 384, 256]); expect([...feeds[1].point_labels.data]).toEqual([1, 0])
    expect(result.candidates).toHaveLength(1); expect(result.candidates[0].area).toBeGreaterThan(0.3); expect(result.candidates[0].area).toBeLessThan(0.7)
  })
})
