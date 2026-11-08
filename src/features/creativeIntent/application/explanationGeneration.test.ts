import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { prepareExplanationGeneration } from './explanationGeneration'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import type { EmbeddedAgentSnapshot } from '@/core/assistant/embeddedAgent'
import type { MotionDraft } from '@/core/creativeIntent/contracts'
import { readPaidFailureFacts } from '@/core/application-control/paidApproval'

const ports = vi.hoisted(() => ({ models: vi.fn(), snapshot: vi.fn(), prompt: vi.fn(), onSnapshot: vi.fn(), resolutions: vi.fn() }))
const paid = vi.hoisted(() => ({ prepare: vi.fn(), start: vi.fn(), complete: vi.fn(), reject: vi.fn(), failed: vi.fn() }))
vi.mock('@/services/paidApproval', () => ({ prepareExplanationPaidApproval: paid.prepare }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ embeddedAgent: ports }) }))
vi.mock('@/core/creativeIntent/semanticIntentRecording', () => ({ semanticRecordingResolutions: ports.resolutions }))
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks()
  paid.prepare.mockResolvedValue({ ...paid, decision: { decision: 'auto', reason: '用户亲自发起', estimatedCny: null, dailySpentCny: 0 }, project: { id: 'project', name: '测试项目' } })
  ports.models.mockResolvedValue([{ name: '实际模型', providerId: 'provider', modelId: 'model', inputModalities: ['text', 'image'] }])
  ports.snapshot.mockResolvedValue({ busy: false }); ports.resolutions.mockResolvedValue([])
})
afterEach(() => { vi.unstubAllGlobals() })
function fixture() {
  const session = recordingFixtureSession('static'); session.state = 'reviewing'
  session.pages = [{ kind: 'transcript', resourceId: 'page', digest: session.sourceDigest, bytes: 1, count: 1, monoSpanUs: [0, 1], seqSpan: [0, 0] }]
  const draft = { id: 'draft' } as MotionDraft
  const local = vi.fn(async () => {})
  let listener: (snapshot: EmbeddedAgentSnapshot) => void = () => {}
  const release = vi.fn()
  ports.onSnapshot.mockImplementation(callback => { listener = callback; return release })
  ports.prompt.mockImplementation(async () => { listener({ busy: true } as EmbeddedAgentSnapshot); listener({ busy: false } as EmbeddedAgentSnapshot) })
  return { session, local, release, host: { documentRef: { kind: 'image_edit.document', id: 'v3:doc' }, session: () => session, drafts: () => [draft], read: vi.fn(), assertCurrent: vi.fn() } }
}
it('预检只读取实际模型且不外发，执行后正式 Pi 读取正文', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  expect(paid.prepare).toHaveBeenCalledOnce()
  expect(ports.prompt).not.toHaveBeenCalled()
  await plan.run(f.local)
  expect(ports.prompt).toHaveBeenCalledWith(expect.objectContaining({ model: { providerId: 'provider', modelId: 'model' }, creativeIntent: { documentRef: f.host.documentRef, sessionId: f.session.id, draftRefs: [{ kind: 'image_edit.intent_draft', id: 'v3:doc:draft' }] } }))
  expect(f.local).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce()
  expect(f.session.consent?.textUpload).toBe(false)
  await expect(plan.run(f.local)).rejects.toThrow('已执行')
})
it('每次任务按准备、开始、完成记账；没有模型时本地整理不记账', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  await plan.run(f.local)
  expect(f.session.consent?.textUpload).toBe(false)
  expect(paid.start).toHaveBeenCalledOnce(); expect(paid.complete).toHaveBeenCalledOnce()
  ports.models.mockResolvedValue([])
  const local = await prepareExplanationGeneration(f.host)
  await local.run(f.local)
  expect(paid.prepare).toHaveBeenCalledOnce()
  expect(ports.prompt).toHaveBeenCalledOnce()
})
it('取消待发送计划只释放一次预留，之后不能继续发送', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  await plan.cancel()
  await plan.cancel()
  expect(paid.reject).toHaveBeenCalledOnce()
  await expect(plan.run(f.local)).rejects.toThrow('已执行')
  expect(ports.prompt).not.toHaveBeenCalled()
})
it('讲解变化使旧准备失效并撤回预留，模型错误仍清理单次授权', async () => {
  const f = fixture(), stale = await prepareExplanationGeneration(f.host)
  f.session.corrections.push({ originalEventRef: 'old', correctedEventRef: 'new' })
  await expect(stale.run(f.local)).rejects.toThrow('讲解已变化')
  expect(paid.reject).toHaveBeenCalledOnce(); expect(ports.prompt).not.toHaveBeenCalled()
  const plan = await prepareExplanationGeneration(f.host)
  ports.prompt.mockRejectedValue(new Error('模型初始化失败'))
  await expect(plan.run(f.local)).rejects.toThrow('模型初始化失败')
  expect(f.local).toHaveBeenCalledOnce(); expect(f.session.consent?.textUpload).toBe(false)
})

it.each(['not_charged', 'submitted', 'completed', 'unknown'] as const)('讲解失败将 %s 原始事实交给费用结算', async billing => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  const failure = Object.assign(new Error('讲解失败'), { paidFailureFacts: { billing } })
  ports.prompt.mockRejectedValueOnce(failure)
  await expect(plan.run(f.local)).rejects.toBe(failure)
  expect(paid.failed).toHaveBeenCalledWith(failure)
  expect(f.session.consent?.textUpload).toBe(false)
})

it('讲解已完成而回执保存失败时，不误用收尾错误的未计费事实', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  const failure = Object.assign(new Error('费用回执保存失败'), { paidFailureFacts: { billing: 'not_charged' } })
  paid.complete.mockRejectedValueOnce(failure)
  await expect(plan.run(f.local)).rejects.toBe(failure)
  expect(readPaidFailureFacts(paid.failed.mock.calls[0]?.[0])).toEqual({ billing: 'completed' })
  expect(f.session.consent?.textUpload).toBe(false)
})

it('需要画面时文本模型不能偷偷发送画面，改走本地整理', async () => {
  const f = fixture(), digest = f.session.sourceDigest
  f.session.visualEvidenceRefs = Array.from({ length: 17 }, (_, seq) => ({ id: `image-${seq}`, kind: 'frame', resourceRef: { resourceId: `image-${seq}`, digest, bytes: 10 },
    size: [640, 360], pixelBudget: 640 * 360, frames: [{ eventId: `pointer-${seq}`, seq, monoUs: seq, timeline: null, unavailableReason: 'static', clockSegmentRef: 'static', stateDigest: digest,
      geometrySnapshotRef: 'geometry', sourceRefs: [], pointer: [.5, .5], reason: 'appearance', attachmentRect: [0, 0, 640, 360] }] }))
  f.session.visualEvidenceRefs.push(f.session.visualEvidenceRefs[0])
  ports.resolutions.mockResolvedValue([{ text: '调整颜色和构图', mentions: [], issues: [], negated: false }])
  const plan = await prepareExplanationGeneration(f.host)
  await plan.run(f.local)
  expect(f.session.consent?.imageUpload).toBe(false)
  ports.models.mockResolvedValue([{ name: '文字模型', providerId: 'provider', modelId: 'text', inputModalities: ['text'] }])
  const local = await prepareExplanationGeneration(f.host)
  await local.run(f.local)
  expect(paid.prepare).toHaveBeenCalledOnce()
  expect(ports.prompt).toHaveBeenCalledOnce()
})
