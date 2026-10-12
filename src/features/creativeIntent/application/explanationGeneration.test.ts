import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { prepareExplanationGeneration } from './explanationGeneration'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import type { EmbeddedAgentSnapshot } from '@/core/assistant/embeddedAgent'
import type { MotionDraft } from '@/core/creativeIntent/contracts'

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
  const consent = vi.fn(async (value: NonNullable<typeof session.consent>) => { session.consent = value })
  const local = vi.fn(async () => {})
  let listener: (snapshot: EmbeddedAgentSnapshot) => void = () => {}
  const release = vi.fn()
  ports.onSnapshot.mockImplementation(callback => { listener = callback; return release })
  ports.prompt.mockImplementation(async () => { listener({ busy: true } as EmbeddedAgentSnapshot); listener({ busy: false } as EmbeddedAgentSnapshot) })
  return { session, local, consent, release, host: { documentRef: { kind: 'image_edit.document', id: 'v3:doc' }, session: () => session, drafts: () => [draft], read: vi.fn(), consent, assertCurrent: vi.fn() } }
}
it('预检只读取实际模型；取消和未授权时不外发，发送后正式 Pi 读取正文', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  expect(plan.request).toMatchObject({ modelName: '实际模型', imageCount: 0 })
  expect(ports.prompt).not.toHaveBeenCalled(); expect(f.consent).not.toHaveBeenCalled()
  await expect(plan.run(f.local)).rejects.toThrow('确认发送')
  await plan.request!.confirm(false)
  expect(f.consent).not.toHaveBeenCalled() // A discarded confirmation cannot leave outbound access behind.
  await plan.run(f.local)
  expect(ports.prompt).toHaveBeenCalledWith(expect.objectContaining({ access: 'write', model: { providerId: 'provider', modelId: 'model' }, creativeIntent: { documentRef: f.host.documentRef, sessionId: f.session.id, draftRefs: [{ kind: 'image_edit.intent_draft', id: 'v3:doc:draft' }] } }))
  expect(f.local).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce()
  expect(f.session.consent?.textUpload).toBe(false)
  await expect(plan.run(f.local)).rejects.toThrow('已执行')
})
it('项目授权交给统一策略，发送权限仅本次生效，本地整理不弹确认', async () => {
  const f = fixture(), plan = await prepareExplanationGeneration(f.host)
  await plan.request!.confirm(true); await plan.run(f.local)
  expect(f.session.consent?.textUpload).toBe(false)
  expect(paid.confirm).toHaveBeenCalledWith(true)
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
  await expect(stale.request!.confirm(true)).rejects.toThrow('讲解已变化')
  const plan = await prepareExplanationGeneration(f.host); await plan.request!.confirm(false)
  ports.prompt.mockRejectedValue(new Error('模型初始化失败'))
  await expect(plan.run(f.local)).rejects.toThrow('模型初始化失败')
  expect(f.local).toHaveBeenCalledOnce(); expect(f.session.consent?.textUpload).toBe(false)
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
  await plan.request!.confirm(true); await plan.run(f.local)
  expect(f.session.consent?.imageUpload).toBe(false)
  ports.models.mockResolvedValue([{ name: '文字模型', providerId: 'provider', modelId: 'text', inputModalities: ['text'] }])
  const local = await prepareExplanationGeneration(f.host)
  expect(local.request).toBeUndefined(); await local.run(f.local)
  expect(ports.prompt).toHaveBeenCalledOnce()
})
