/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检使用 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { assignIsolatedMcpPort, authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })

/**
 * 批注闭环（2026-10-24 按现行流程重写）：用户用时间线里的批注工具在节目画面上画箭头和圈、改颜色、拖动，
 * 复制给外部 Agent；外部 Agent 读批注后在同一个事务里写关键帧、追加回复、标为待审查；用户在批注面板逐条通过，
 * 或“撤销这次修改”一步回到处理前。录制 → 交给 AI → 整理的超级关键帧流程由 video-edit-motion-draft 场景覆盖。
 */
function createVideoEditAnnotationRelativeScene() {
  return { id: 'video-edit-annotation-relative', surface: '剪辑', name: '剪辑-批注绘制与助手处理', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/t155-annotation-relative'); fs.mkdirSync(root, { recursive: true })
      const evidence = { shots: [], frames: [], paidCalls: 0 }; let client; let seeded
      const unblock = await blockPaidGeneration(app)
      const shot = async name => { await page.waitForTimeout(160); evidence.shots.push(name); await capture('step-' + String(evidence.shots.length).padStart(3, '0')) }
      const saved = async test => { for (let i = 0; i < 200; i++) { const doc = readVideoEditFile(seeded.file); if (test(doc)) return doc; await page.waitForTimeout(50) } assert.fail('文档没有保存预期动作') }
      const presented = async frame => page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame)
      const layer = () => page.getByLabel('画面标注层', { exact: true })
      // 批注是命令带里的工具（重要记录 019）：先进入批注工具，形状与颜色在紧跟其后的批注参数条里选。
      const options = () => page.locator('[data-video-edit-annotation-options]').first()
      const shape = async name => {
        if (!await options().isVisible()) await page.getByRole('group', { name: '时间线工具', exact: true }).getByRole('button', { name: '批注工具', exact: true }).click()
        await options().getByRole('radiogroup', { name: '批注形状', exact: true }).getByRole('radio', { name, exact: true }).click()
        await page.waitForFunction(() => document.querySelector('[aria-label="画面标注层"]')?.classList.contains('cursor-crosshair'))
      }
      const at = async (x, y) => { const rect = await layer().boundingBox(); assert(rect); return [rect.x + x * rect.width, rect.y + y * rect.height] }
      const drag = async (from, to, { shift = false } = {}) => {
        await page.mouse.move(...await at(...from)); await page.mouse.down()
        if (shift) await page.keyboard.down('Shift')
        await page.mouse.move(...await at(...to), { steps: 8 }); await page.mouse.up()
        if (shift) await page.keyboard.up('Shift')
      }
      const answer = async text => { const input = page.getByLabel('这里要改什么？', { exact: true }); await input.fill(text); await input.press('Enter'); await input.waitFor({ state: 'hidden' }) }
      const marks = () => readVideoEditFile(seeded.file).sequences[0].annotations
      try {
        const source = path.join(root, 'source.png')
        await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/><circle cx="640" cy="360" r="230" fill="black"/></svg>')).png().toFile(source)
        const project = fixture(source); project.id = 'reality-t155'; const seq = project.sequences[0]
        seq.clips[0].name = '运动目标'; seq.clips[0].scale = .15; seq.clips[0].x = -.2; seq.clips[0].y = -.15
        loadTypeScript('src/core/videoEdit/document.ts').videoEditDocumentSchema.parse(project)
        await assignIsolatedMcpPort(page)
        await button(page, '剪辑').first().click(); seeded = await seedVideoEditProject(page, project)
        await page.evaluate(async ({ source, projectId, id }) => {
          const api = window.henjiNative.documents; const resource = await api.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
          const read = await api.readDocument({ id }); read.content.media[0].path = resource.path
          await api.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
        }, { source, projectId: seeded.projectId, id: seeded.documentId })
        await openVideoEditProjectCard(page, seeded.projectId); await presented(0)
        const identity = await authorizeMcpConnection(page, { name: '批注闭环免费验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji annotation loop Reality')
        const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
        const clipRef = { kind: 'video_edit.clip', id: seeded.documentId + ':motion-clip' }
        const sequenceRef = { kind: 'video_edit.sequence', id: seeded.documentId + ':motion-sequence' }
        const focus = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: clipRef })); assert.equal(focus.executionState, 'completed', JSON.stringify(focus))
        const playback = async frame => {
          const key = 'video_edit.document.program_playback'
          const baseline = await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: [key] })
          const result = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '定位验收帧', changes: [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { [key]: { frame, playing: false, playbackDirection: 1 } } }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); await presented(frame)
        }

        // 1. 用户画：Shift 拖出 45° 箭头，再画一个圈并换成黄色，最后把圈拖到右下。
        await shape('箭头'); await drag([.3, .3], [.62, .58], { shift: true }); await answer('沿箭头方向移动')
        let current = await saved(doc => doc.sequences[0].annotations.length === 1); const arrow = current.sequences[0].annotations[0]
        assert.equal(arrow.target.kind, 'arrow'); assert.equal(arrow.status, 'draft'); assert.equal(arrow.style?.color ?? 'red', 'red')
        const dx = (arrow.target.to.x - arrow.target.from.x) * 1280; const dy = (arrow.target.to.y - arrow.target.from.y) * 720
        assert.ok(Math.abs(Math.abs(dx) - Math.abs(dy)) < 4, `Shift 应把箭头吸附到 45°：${dx} × ${dy}`)
        await shape('圈'); await drag([.6, .55], [.78, .8]); await answer('最后停在圈里')
        await options().getByRole('radio', { name: '黄色', exact: true }).click()
        current = await saved(doc => doc.sequences[0].annotations[1]?.style?.color === 'yellow'); const before = current.sequences[0].annotations[1].target
        assert.equal(before.kind, 'ellipse')
        await drag([before.x + .02, before.y + before.height / 2], [before.x + .06, before.y + before.height / 2 + .03])
        current = await saved(doc => doc.sequences[0].annotations[1].target.x > before.x + .02); const circle = current.sequences[0].annotations[1].target
        await shot('画箭头和圈')

        // 2. 复制给外部 Agent：两条一起从待发送变成待处理。
        await options().getByRole('button', { name: '发送给助手 · 2', exact: true }).waitFor({ state: 'visible' })
        await options().getByRole('button', { name: '更多批注操作', exact: true }).click()
        await page.getByRole('menuitem', { name: '复制给外部 Agent', exact: true }).click(); await saved(doc => doc.sequences[0].annotations.every(mark => mark.status === 'open'))
        await shot('复制给外部助手')

        // 3. 外部 Agent：读批注，沿箭头把片段从起点移到圈中心，同一事务回复并标为待审查。
        const listed = await callTool(client, 'list_application_entities', { entityType: 'video_edit.annotation', propertyIds: ['video_edit.annotation.target', 'video_edit.annotation.text', 'video_edit.annotation.status'] })
        assert.equal(listed.data.refs.length, 2); const [arrowRef, circleRef] = listed.data.refs
        const read = await callTool(client, 'read_application_entity', { ref: clipRef })
        const marksRead = await Promise.all([arrowRef, circleRef].map(ref => callTool(client, 'read_application_entity', { ref })))
        const end = { x: circle.x + circle.width / 2 - .5, y: circle.y + circle.height / 2 - .5 }; const start = { x: arrow.target.from.x - .5, y: arrow.target.from.y - .5 }
        const reply = text => ({ id: 'reply-' + Math.random().toString(16).slice(2), author: { kind: 'external', name: '验收 Agent' }, createdAt: new Date().toISOString(), text })
        const addressed = await callTool(client, 'change_application_entities', operationEnvelope([read, ...marksRead], { summary: '按批注沿箭头移入圈内', changes: [
          { kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: {
            'video_edit.clip.x.keyframes': [{ time: 0, value: start.x, interpolation: 'ease' }, { time: 24, value: end.x, interpolation: 'hold' }],
            'video_edit.clip.y.keyframes': [{ time: 0, value: start.y, interpolation: 'ease' }, { time: 24, value: end.y, interpolation: 'hold' }],
          } },
          ...[[arrowRef, '从箭头起点沿箭头方向移动，0–24 帧缓入缓出。'], [circleRef, '第 24 帧停在圈的中心。']].map(([ref, text]) => ({ kind: 'mutate_properties', entityType: 'video_edit.annotation', target: { kind: ref.kind, id: ref.id }, mutations: [
            { propertyId: 'video_edit.annotation.thread', operation: 'append', value: reply(text) }, { propertyId: 'video_edit.annotation.status', operation: 'set', value: 'addressed' },
          ] })),
        ] }))
        assert.equal(addressed.executionState, 'completed', JSON.stringify(addressed))
        current = await saved(doc => doc.sequences[0].annotations.every(mark => mark.status === 'addressed') && doc.sequences[0].clips[0].curves?.x)
        for (const frame of [0, 12, 24]) { await playback(frame); await capture('loop-frame-' + String(frame).padStart(3, '0')); evidence.frames.push(frame) }
        await shot('助手处理后待审查')

        // 4. 用户审查：先通过圈那条（状态变“已通过”），再“重开”；然后对箭头“撤销这次修改”，
        //    同一次处理的关键帧一步撤掉，两条都回到待处理，讨论记录保留。
        // 参数条上的“待审查 · 2”把批注面板带到前面；选中（展开）一条才出现它的审查按钮。
        await options().getByRole('button', { name: '待审查 · 2', exact: true }).click()
        const panel = page.getByLabel('批注面板', { exact: true }); await panel.waitFor({ state: 'visible' })
        const row = number => panel.locator('[data-video-edit-annotation]').nth(number - 1)
        await panel.getByRole('button', { name: '跳到标注 2', exact: true }).click()
        await row(2).getByRole('button', { name: '通过', exact: true }).click()
        await saved(doc => doc.sequences[0].annotations[1].status === 'resolved'); await shot('审查通过一条')
        await row(2).getByRole('button', { name: '重开', exact: true }).click()
        await saved(doc => doc.sequences[0].annotations[1].status === 'open')
        await panel.getByRole('button', { name: '跳到标注 1', exact: true }).click()
        await row(1).getByRole('button', { name: '撤销这次修改', exact: true }).click()
        current = await saved(doc => !doc.sequences[0].clips[0].curves?.x && doc.sequences[0].annotations.every(mark => mark.status === 'open'))
        assert.ok(current.sequences[0].annotations[0].thread.length >= 1, '撤销处理不应抹掉讨论记录')
        await playback(0); await shot('撤销这次修改')
        evidence.sequence = sequenceRef; evidence.annotations = current.sequences[0].annotations.map(mark => ({ kind: mark.target.kind, status: mark.status, color: mark.style?.color }))
      } catch (error) {
        evidence.failure = error.stack
        evidence.visibleText = await page.locator('body').innerText().catch(() => '')
        await capture('failure')
        throw error
      } finally {
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        await client?.close(); await disableMcp(page).catch(() => {}); await unblock()
      }
    },
  }
}
module.exports = { createVideoEditAnnotationRelativeScene }
