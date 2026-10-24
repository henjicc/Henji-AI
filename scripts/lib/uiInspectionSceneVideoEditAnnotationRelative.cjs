/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检使用 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })

function createVideoEditAnnotationRelativeScene() {
  return { id: 'video-edit-annotation-relative', surface: '剪辑', name: '剪辑-标注约束与相对参照', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/t155-annotation-relative'); fs.mkdirSync(root, { recursive: true })
      const evidence = { shots: [], frames: [], paidCalls: 0 }; let client; let seeded
      const unblock = await blockPaidGeneration(app)
      const controls = page.locator('[data-creative-intent-controls]')
      const trigger = () => page.getByRole('button', { name: /^(超级关键帧|正在示范)$/ })
      const panel = async () => { if (!await controls.isVisible()) await trigger().click(); await controls.waitFor({ state: 'visible' }) }
      const close = async () => { if (await controls.isVisible()) await trigger().click() }
      const mode = async name => {
        // 批注是时间线工具栏里的工具：右键选形状；节目画面自己的下拉只剩选择与移动画面。
        if (name === '画笔标注') {
          await page.getByRole('toolbar', { name: '时间线工具栏', exact: true }).getByRole('button', { name: '批注工具', exact: true }).click({ button: 'right' })
          await page.getByRole('menuitem', { name: /^画笔/ }).click(); return
        }
        await page.getByRole('toolbar', { name: '节目监视器控制', exact: true }).getByRole('button', { name: /^(选择|移动画面|批注)$/ }).first().click()
        await page.getByRole('group', { name: '节目画面模式', exact: true }).getByRole('button', { name, exact: true }).click()
      }
      const shot = async name => { await page.waitForTimeout(160); evidence.shots.push(name); await capture('step-' + String(evidence.shots.length).padStart(3, '0')) }
      const saved = async test => { for (let i = 0; i < 200; i++) { const doc = readVideoEditFile(seeded.file); if (test(doc)) return doc; await page.waitForTimeout(50) } assert.fail('文档没有保存预期动作') }
      const presented = async frame => page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame)
      try {
        const source = path.join(root, 'source.png')
        await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/><circle cx="640" cy="360" r="230" fill="black"/></svg>')).png().toFile(source)
        const project = fixture(source); project.id = 'reality-t155'; const seq = project.sequences[0]
        seq.clips[0].name = '运动目标'; seq.clips[0].scale = .15
        seq.tracks.push({ ...structuredClone(seq.tracks.find(t => t.kind === 'video')), id: 'reference-track', name: '视频 2', index: 2 })
        seq.clips.push({ ...structuredClone(seq.clips[0]), id: 'reference-clip', name: '参照元素', x: -.15, y: .1, scale: .1, track: 2 })
        loadTypeScript('src/core/videoEdit/document.ts').videoEditDocumentSchema.parse(project)
        await button(page, '剪辑').first().click(); seeded = await seedVideoEditProject(page, project)
        await page.evaluate(async ({ source, projectId, id }) => {
          const api = window.henjiNative.documents; const resource = await api.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
          const read = await api.readDocument({ id }); read.content.media[0].path = resource.path
          await api.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
        }, { source, projectId: seeded.projectId, id: seeded.documentId })
        await openVideoEditProjectCard(page, seeded.projectId); await presented(0)
        const identity = await authorizeMcpConnection(page, { name: '标注与相对运动免费验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji annotation relative Reality')
        const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
        const clipRef = { kind: 'video_edit.clip', id: seeded.documentId + ':motion-clip' }
        const focus = async ref => { const result = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref })); assert.equal(result.executionState, 'completed', JSON.stringify(result)) }
        const playback = async frame => {
          await close(); const key = 'video_edit.document.program_playback'
          const baseline = await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: [key] })
          const result = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '定位验收帧', changes: [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { [key]: { frame, playing: false, playbackDirection: 1 } } }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); await presented(frame)
        }
        await focus(clipRef)
        const stroke = async (points, text) => {
          await close(); await mode('画笔标注')
          const rect = await page.getByLabel('画面标注层', { exact: true }).boundingBox(); assert(rect)
          await page.mouse.move(rect.x + points[0][0] * rect.width, rect.y + points[0][1] * rect.height); await page.mouse.down()
          for (const p of points.slice(1)) await page.mouse.move(rect.x + p[0] * rect.width, rect.y + p[1] * rect.height, { steps: 3 })
          await page.mouse.up()
          if (text === '沿箭头方向移动') {
            // 再画一笔：点画面会收起输入框，画笔草稿保留并合并成同一条（Esc 在输入框里是放弃）。
            await page.mouse.move(rect.x + .69 * rect.width, rect.y + .57 * rect.height); await page.mouse.down()
            await page.mouse.move(rect.x + .75 * rect.width, rect.y + .65 * rect.height, { steps: 3 })
            await page.mouse.move(rect.x + .65 * rect.width, rect.y + .65 * rect.height, { steps: 3 }); await page.mouse.up()
          }
          await page.getByLabel('这里要改什么？', { exact: true }).fill(text); await button(page, '加入待发送').click()
          await mode('移动画面')
        }
        await stroke([[.25, .3], [.75, .65]], '沿箭头方向移动')
        await shot('绘制方向标注')
        await panel(); await page.getByLabel('使用标注', { exact: true }).click(); await page.getByRole('option', { name: '沿箭头方向移动', exact: true }).click()
        await page.getByLabel('结束帧', { exact: true }).fill('24'); await page.getByLabel('结束帧', { exact: true }).press('Enter')
        await button(page, '按标注整理').click(); await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 }); await shot('箭头方向候选')
        await button(page, '应用').click(); await saved(doc => doc.sequences[0].annotations[0].status === 'addressed'); await shot('应用与待审查')
        for (let frame = 0; frame <= 24; frame++) { await playback(frame); await capture('arrow-frame-' + String(frame).padStart(3, '0')); evidence.frames.push({ kind: 'arrow', frame }) }
        await button(page, '撤销').click(); await saved(doc => !doc.sequences[0].clips[0].curves?.x); await shot('一步撤销曲线与处理回复')
        await playback(0)
        const circle = Array.from({ length: 33 }, (_, i) => [.6 + .08 * Math.cos(i * Math.PI / 16), .4 + .1 * Math.sin(i * Math.PI / 16)])
        await stroke(circle, '在圈内停留')
        await panel(); await button(page, '清除标注与参照约束').click()
        await page.getByLabel('使用标注', { exact: true }).click(); await page.getByRole('option', { name: '在圈内停留', exact: true }).click()
        await page.getByLabel('标注含义', { exact: true }).click(); await page.getByRole('option', { name: '在圈内停留', exact: true }).click()
        await page.getByLabel('结束帧', { exact: true }).fill('24'); await page.getByLabel('结束帧', { exact: true }).press('Enter')
        await button(page, '按标注整理').click(); await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 }); await shot('圈内停留候选')
        await button(page, '应用').click(); await saved(doc => doc.sequences[0].annotations[1].status === 'addressed')
        for (const frame of [0, 12, 24]) { await playback(frame); await shot('停留帧' + frame) }
        await button(page, '撤销').click(); await saved(doc => !doc.sequences[0].clips[0].curves?.x)
        await playback(0); await panel(); await button(page, '清除标注与参照约束').click(); await button(page, '开始示范').click()
        await page.getByLabel('相对参照', { exact: true }).click(); await page.getByRole('option', { name: '参照元素', exact: true }).click(); await close()
        const drag = async dx => {
          const rect = await page.locator('[data-video-edit-program-display]').boundingBox(); assert(rect)
          await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5); await page.mouse.down()
          await page.mouse.move(rect.x + rect.width * (.5 + dx), rect.y + rect.height * .5, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(100)
        }
        await drag(.03)
        // User-controlled timeline placement, followed by an explicit second pose.
        const baseline = await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.timeline_view'] })
        const view = baseline.data.properties['video_edit.document.timeline_view']; const ruler = await page.getByRole('slider', { name: '剪辑时间定位', exact: true }).boundingBox()
        await page.mouse.click(ruler.x + 24 * 60 * view.zoom / 30 + .1, ruler.y + 12); await presented(24); await drag(.04)
        await panel(); await button(page, '结束示范').click(); await button(page, '开始示范').waitFor({ state: 'visible' })
        await controls.getByRole('button', { name: '整理', exact: true }).click(); await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 }); await shot('相对参照候选')
        await close()
        const referenceRef = { kind: 'video_edit.clip', id: seeded.documentId + ':reference-clip' }; const property = 'video_edit.clip.x'
        const referenceBaseline = await callTool(client, 'read_application_entity', { ref: referenceRef, propertyIds: [property] })
        const shifted = await callTool(client, 'change_application_entities', operationEnvelope([referenceBaseline], { summary: '移动参照后重新整理', changes: [{ kind: 'set_properties', entityType: referenceRef.kind, target: referenceRef, properties: { [property]: -.05 } }] }))
        assert.equal(shifted.executionState, 'completed', JSON.stringify(shifted)); await shot('参照元素移动')
        await panel(); await controls.getByRole('button', { name: '重新整理', exact: true }).click()
        await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 }); await shot('参照移动后重新整理局部偏移')
        await button(page, '应用').click(); const applied = await saved(doc => doc.creativeIntents?.drafts.at(-1)?.applications.at(-1)?.saved)
        evidence.applied = applied.sequences[0].clips.map(c => ({ id: c.id, groupId: c.groupId, curves: c.curves }))
        for (const frame of [0, 12, 24]) { await playback(frame); await shot('相对运动帧' + frame) }
        await button(page, '撤销').click(); await shot('相对运动一次撤销')
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
