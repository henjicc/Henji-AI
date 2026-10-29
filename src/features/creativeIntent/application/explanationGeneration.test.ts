import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { prepareExplanationGeneration } from './explanationGeneration'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import type { EmbeddedAgentSnapshot } from '@/core/assistant/embeddedAgent'
import type { MotionDraft } from '@/core/creativeIntent/contracts'
import { readPaidFailureFacts } from '@/core/application-control/paidApproval'

const ports = vi.hoisted(() => ({ models: vi.fn(), snapshot: vi.fn(), prompt: vi.fn(), onSnapshot: vi.fn(), resolutions: vi.fn() }))
const paid = vi.hoisted(() => ({ prepare: vi.fn(), confirm: vi.fn(), start: vi.fn(), complete: vi.fn(), reject: vi.fn(), failed: vi.fn() }))
vi.mock('@/services/paidApproval', () => ({ prepareExplanationPaidApproval: paid.prepare }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ embeddedAgent: ports }) }))
vi.mock('@/core/creativeIntent/semanticIntentRecording', () => ({ semanticRecordingResolutions: ports.resolutions }))
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks()
  paid.prepare.mockResolvedValue({ ...paid, decision: { decision: 'ask', reason: '每次询问', estimatedCny: null, dailySpentCny: 0 }, project: { id: 'project', name: '测试项目' } })
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
it('预检只读取实际模型；取消和未授权时不外发，发送后正式 Pi 读取正文', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  expect(plan.request).toMatchObject({ modelName: '实际模型', imageCount: 0 })
  expect(ports.prompt).not.toHaveBeenCalled()
  await expect(plan.run(f.local)).rejects.toThrow('确认发送')
  await plan.request!.confirm()
  await plan.run(f.local)
  expect(ports.prompt).toHaveBeenCalledWith(expect.objectContaining({ model: { providerId: 'provider', modelId: 'model' }, creativeIntent: { documentRef: f.host.documentRef, sessionId: f.session.id, draftRefs: [{ kind: 'image_edit.intent_draft', id: 'v3:doc:draft' }] } }))
  expect(f.local).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce()
  expect(f.session.consent?.textUpload).toBe(false)
  await expect(plan.run(f.local)).rejects.toThrow('已执行')
})
it('付费交给统一策略，每次任务只消费原确认，本地整理不弹确认', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  await plan.request!.confirm(); await plan.run(f.local)
  expect(f.session.consent?.textUpload).toBe(false)
  expect(paid.confirm).toHaveBeenCalledWith()
  paid.prepare.mockResolvedValueOnce({ ...paid, decision: { decision: 'auto', reason: '全部放行', estimatedCny: null, dailySpentCny: 0 } })
  expect((await prepareExplanationGeneration(f.host)).request).toBeUndefined()
  ports.models.mockResolvedValue([])
  const local = await prepareExplanationGeneration(f.host)
  expect(local.request).toBeUndefined(); await local.run(f.local)
  expect(ports.prompt).toHaveBeenCalledOnce()
})
it('取消待发送计划只释放一次预留，之后不能继续发送', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  await plan.request!.cancel()
  await plan.cancel()
  expect(paid.reject).toHaveBeenCalledOnce()
  await expect(plan.run(f.local)).rejects.toThrow('已执行')
  expect(ports.prompt).not.toHaveBeenCalled()
})
it('讲解变化使旧确认失效，模型错误仍清理单次授权', async () => {
  const f = fixture(), stale = await prepareExplanationGeneration(f.host)
  f.session.corrections.push({ originalEventRef: 'old', correctedEventRef: 'new' })
  await expect(stale.request!.confirm()).rejects.toThrow('讲解已变化')
  const plan = await prepareExplanationGeneration(f.host); await plan.request!.confirm()
  ports.prompt.mockRejectedValue(new Error('模型初始化失败'))
  await expect(plan.run(f.local)).rejects.toThrow('模型初始化失败')
  expect(f.local).toHaveBeenCalledOnce(); expect(f.session.consent?.textUpload).toBe(false)
})

it.each(['not_charged', 'submitted', 'completed', 'unknown'] as const)('讲解失败将 %s 原始事实交给费用结算', async billing => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  await plan.request!.confirm()
  const failure = Object.assign(new Error('讲解失败'), { paidFailureFacts: { billing } })
  ports.prompt.mockRejectedValueOnce(failure)
  await expect(plan.run(f.local)).rejects.toBe(failure)
  expect(paid.failed).toHaveBeenCalledWith(failure)
  expect(f.session.consent?.textUpload).toBe(false)
})

it('讲解已完成而回执保存失败时，不误用收尾错误的未计费事实', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  await plan.request!.confirm()
  const failure = Object.assign(new Error('费用回执保存失败'), { paidFailureFacts: { billing: 'not_charged' } })
  paid.complete.mockRejectedValueOnce(failure)
  await expect(plan.run(f.local)).rejects.toBe(failure)
  expect(readPaidFailureFacts(paid.failed.mock.calls[0]?.[0])).toEqual({ billing: 'completed' })
  expect(f.session.consent?.textUpload).toBe(false)
})

it('确认显示实际去重后的必要画面总数，文本模型不能偷偷发送画面', async () => {
  const f = fixture(), digest = f.session.sourceDigest
  f.session.visualEvidenceRefs = Array.from({ length: 17 }, (_, seq) => ({ id: `image-${seq}`, kind: 'frame', resourceRef: { resourceId: `image-${seq}`, digest, bytes: 10 },
    size: [640, 360], pixelBudget: 640 * 360, frames: [{ eventId: `pointer-${seq}`, seq, monoUs: seq, timeline: null, unavailableReason: 'static', clockSegmentRef: 'static', stateDigest: digest,
      geometrySnapshotRef: 'geometry', sourceRefs: [], pointer: [.5, .5], reason: 'appearance', attachmentRect: [0, 0, 640, 360] }] }))
  f.session.visualEvidenceRefs.push(f.session.visualEvidenceRefs[0])
  ports.resolutions.mockResolvedValue([{ text: '调整颜色和构图', mentions: [], issues: [], negated: false }])
  const plan = await prepareExplanationGeneration(f.host)
  expect(plan.request?.imageCount).toBe(17)
  await plan.request!.confirm(); await plan.run(f.local)
  expect(f.session.consent?.imageUpload).toBe(false)
  ports.models.mockResolvedValue([{ name: '文字模型', providerId: 'provider', modelId: 'text', inputModalities: ['text'] }])
  const local = await prepareExplanationGeneration(f.host)
  expect(local.request).toBeUndefined(); await local.run(f.local)
  expect(ports.prompt).toHaveBeenCalledOnce()
})
