import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { rehomeVideoMotionResources } from './video-motion-resources'
import { creativeIntentsSchema } from '../../../../src/core/creativeIntent/persistence'
import { creativeIntentPageSchema } from '../../../../src/core/creativeIntent/pages'
import { assertCandidateCurrent, motionCandidateIdentity } from '../../../../src/core/creativeIntent/candidates'
import { createTestEnvironment, silentLogger } from './documents.test-support'
import { VIDEO_EDIT_CONTENT_VERSION } from '../../../../src/core/persistence/schemaVersions'
import { PACKAGE_VERSION } from '../../../../src/core/persistence/storedSchemas'
it('复制或项目包重配身份时，页和候选完整改绑；源文件和资源身份保持不变', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-motion-'))
  try {
    const envelope = JSON.parse(await fs.readFile('tests/fixtures/persistence/document.video_edit/v2.json', 'utf8'))
    const pages = JSON.parse(await fs.readFile('tests/fixtures/persistence/creative-intent-page/v1.json', 'utf8'))
    const candidate = JSON.parse(await fs.readFile('tests/fixtures/persistence/creative-intent-candidate/v1.json', 'utf8'))
    envelope.content.creativeIntents.drafts[0].applications.push({ candidateRef: 'golden-motion-candidate', operationRef: { kind: 'creative_intent.application', id: 'application' }, receiptRef: { kind: 'video_edit.document', id: envelope.id }, saved: true })
    await fs.mkdir(path.join(root, '素材'))
    const original = JSON.stringify(envelope.content)
    await fs.writeFile(path.join(root, '素材/golden-motion-page.json'), JSON.stringify(pages))
    await fs.writeFile(path.join(root, '素材/golden-motion-candidate.json'), JSON.stringify(candidate))
    const next = await rehomeVideoMotionResources(envelope.content, envelope.id, 'copied', root) as { creativeIntents: unknown }
    const head = creativeIntentsSchema.parse(next.creativeIntents)
    expect(head.drafts[0].ownerRef.id).toBe('copied'); expect(head.drafts[0].targets[0].ref.id).toBe('copied:golden-clip')
    for (const resource of head.resources) {
      expect(resource.resourceId).not.toMatch(/^golden-motion-/)
      const bytes = await fs.readFile(path.join(root, resource.path.slice(7)))
      expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(resource.digest)
      if (resource.kind === 'page') expect(creativeIntentPageSchema.parse(JSON.parse(bytes.toString())).ownerRef.id).toBe('copied')
      if (resource.kind === 'candidate') {
        const copied = JSON.parse(bytes.toString()); const request = JSON.parse(copied.identity.requestKey)
        expect(() => assertCandidateCurrent(copied, motionCandidateIdentity(head.drafts[0], { mappings: Object.fromEntries(request.mappings), intent: request.intent ?? undefined, selectedTakeIds: request.takes ?? undefined }))).not.toThrow()
      }
    }
    expect(head.drafts[0].applications[0].receiptRef.id).toBe('copied')
    expect(head.drafts[0].applications[0].candidateRef).toBe(head.resources.find(r => r.kind === 'candidate')!.resourceId)
    expect(await fs.readFile(path.join(root, '素材/golden-motion-page.json'), 'utf8')).toBe(JSON.stringify(pages)); expect(JSON.stringify(envelope.content)).toBe(original)
    await expect(rehomeVideoMotionResources(envelope.content, 'foreign', 'another', root)).rejects.toThrow('归属')
    await fs.writeFile(path.join(root, '素材/golden-motion-page.json'), '{}')
    await expect(rehomeVideoMotionResources(envelope.content, envelope.id, 'another', root)).rejects.toThrow()
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('正式项目包导入、剪辑移动、再次导出重开保留全部原稿、时钟与钉点', async () => {
  const warnings: unknown[] = []
  const env = createTestEnvironment({ logger: { ...silentLogger(), warn: (_message, details) => { warnings.push(details) } } })
  try {
    const { service } = env.services
    // 黄金包含固定 id-0001；先占用它，使测试 ID 生成器走真实冲突重配，避免与后建项目碰撞。
    await service.createProject({ name: '原稿身份冲突' })
    const imported = await service.importPackage({ source: path.resolve('tests/fixtures/persistence/project-package', `v${PACKAGE_VERSION}-video-v${VIDEO_EDIT_CONTENT_VERSION}.henjipack`) })
    if (imported.type !== 'project') throw new Error('应为剪辑项目包')
    const document = env.catalog.listDocuments({ projectId: imported.project.id, kind: 'video_edit' })[0]
    const snapshot = async (id: string) => {
      const read = await service.readDocument({ id })
      const head = creativeIntentsSchema.parse((read.content as { creativeIntents: unknown }).creativeIntents)
      const samples = []
      for (const resource of head.resources) {
        const bytes = await fs.readFile(resource.path)
        expect(bytes.byteLength).toBe(resource.bytes)
        expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(resource.digest)
        if (resource.kind === 'page') {
          const page = creativeIntentPageSchema.parse(JSON.parse(bytes.toString()))
          expect(page.ownerRef.id).toBe(id)
          if (page.kind === 'samples') samples.push(...page.entries.map(sample => ({ seq: sample.seq, monoUs: sample.monoUs, frame: sample.timeline?.frame, pose: sample.pose, event: sample.event, quality: sample.quality })))
        }
      }
      return { sampleCount: samples.length, samplesDigest: createHash('sha256').update(JSON.stringify(samples)).digest('hex'), pins: head.drafts.map(draft => draft.pins.map(pin => ({ ...pin, targetRef: { ...pin.targetRef, id: pin.targetRef.id.slice(id.length) } }))), clocks: head.drafts.map(draft => draft.clockSegments.map(segment => ({ mode: segment.mode, monoSpanUs: segment.monoSpanUs, anchors: segment.anchors.map(anchor => ({ monoUs: anchor.monoUs, presentedFrame: anchor.presentedFrame, playbackRate: anchor.playbackRate })) }))) }
    }
    const before = await snapshot(document.id)
    expect(before.sampleCount).toBe(721)
    const destination = await service.createProject({ name: '原稿搬运' })
    const moved = await service.moveDocument({ target: { id: document.id }, container: { kind: 'project', projectId: destination.id } })
    expect(moved.meta.container).toEqual({ kind: 'project', projectId: destination.id })
    expect(path.dirname(moved.meta.path)).toBe(destination.path)
    expect(await snapshot(document.id)).toEqual(before)
    const exported = await service.exportProjectPackage({ projectId: destination.id, destination: path.join(env.outside, '带原稿剪辑') })
    expect(warnings).toEqual([])
    expect(exported.missingPaths).toEqual([])
    const reopened = await service.importPackage({ source: exported.path })
    if (reopened.type !== 'project') throw new Error('应为剪辑项目包')
    const copied = env.catalog.listDocuments({ projectId: reopened.project.id, kind: 'video_edit' })[0]
    expect({ count: reopened.documents, documents: env.catalog.listDocuments({ projectId: reopened.project.id }) }).toMatchObject({ count: 1, documents: [expect.objectContaining({ kind: 'video_edit' })] })
    expect(copied.id).not.toBe(document.id)
    expect(await snapshot(copied.id)).toEqual(before)
  } finally { await env.cleanup() }
})
