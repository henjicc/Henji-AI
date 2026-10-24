/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检使用 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
function createVideoEditPrimitivesScene() {
  return { id: 'video-edit-primitives', surface: '剪辑', name: '剪辑-动作原语两周与普通曲线编辑', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/t151-primitives'); fs.mkdirSync(root, { recursive: true })
      const evidence = { shots: [], frames: [], paidCalls: 0 }; let client; let seeded
      const unblock = await blockPaidGeneration(app)
      const controls = page.locator('[data-creative-intent-controls]')
      const trigger = () => page.getByRole('button', { name: /^(超级关键帧|正在示范)$/ })
      const panel = async () => { if (!await controls.isVisible()) await trigger().click(); await controls.waitFor({ state: 'visible' }) }
      const close = async () => { if (await controls.isVisible()) { await trigger().click(); await controls.waitFor({ state: 'hidden' }) } }
      const shot = async name => { await page.waitForTimeout(240); evidence.shots.push(name); await capture('step-' + String(evidence.shots.length).padStart(3, '0')) }
      const presented = async frame => page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame)
      const saved = async test => { for (let i = 0; i < 200; i++) { const doc = readVideoEditFile(seeded.file); if (test(doc)) return doc; await page.waitForTimeout(50) } assert.fail('文档没有保存预期动作') }
      try {
        const source = path.join(root, 'source.png')
        await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/><circle cx="640" cy="360" r="230" fill="black"/></svg>')).png().toFile(source)
        const project = fixture(source); project.sequences[0].clips[0].scale = .18
        await button(page, '剪辑').first().click(); seeded = await seedVideoEditProject(page, project)
        await page.evaluate(async ({ source, projectId, id }) => {
          const api = window.henjiNative.documents; const resource = await api.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
          const read = await api.readDocument({ id }); read.content.media[0].path = resource.path
          await api.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
        }, { source, projectId: seeded.projectId, id: seeded.documentId })
        await openVideoEditProjectCard(page, seeded.projectId); await presented(0)
        const identity = await authorizeMcpConnection(page, { name: '动作原语免费验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji primitives Reality')
        const projectRef = { kind: 'video_edit.document', id: seeded.documentId }; const clipRef = { kind: 'video_edit.clip', id: seeded.documentId + ':motion-clip' }
        const read = async (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const playback = async frame => {
          await close(); const property = 'video_edit.document.program_playback'; const baseline = await read(projectRef, [property])
          const result = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '定位验收帧', changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { [property]: { frame, playing: false, playbackDirection: 1 } } }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); await presented(frame)
        }
        const focus = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: clipRef })); assert.equal(focus.executionState, 'completed', JSON.stringify(focus))
        const scrub = async frame => {
          await close(); const view = (await read(projectRef, ['video_edit.document.timeline_view'])).data.properties['video_edit.document.timeline_view']
          const rect = await page.getByRole('slider', { name: '剪辑时间定位', exact: true }).boundingBox(); assert(rect)
          await page.mouse.move(rect.x + frame * 60 * view.zoom / 30 + .1, rect.y + 12); await page.mouse.down(); await page.mouse.up(); await presented(frame)
        }
        const drag = async (dx, dy = 0) => {
          await close(); const rect = await page.locator('[data-video-edit-program-display]').boundingBox(); assert(rect)
          await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5); await page.mouse.down()
          for (let i = 1; i <= 6; i++) { await page.mouse.move(rect.x + rect.width * (.5 + dx * i / 6), rect.y + rect.height * (.5 + dy * i / 6)); await page.waitForTimeout(25) }
          await page.mouse.up(); await page.waitForTimeout(80)
        }
        await shot('单素材基态：无阶梯缺口')
        await panel(); await button(page, '开始示范').click(); await drag(.12)
        // Demonstrate two real revolutions through pointer gestures; never inject draft samples.
        for (let i = 1; i <= 32; i++) {
          await scrub(Math.round(i * 240 / 32))
          const a = (i - 1) * Math.PI / 8; const b = i * Math.PI / 8
          await drag(.12 * (Math.cos(b) - Math.cos(a)), .12 * (Math.sin(b) - Math.sin(a)))
        }
        await panel(); await button(page, '结束示范').click(); await button(page, '开始示范').waitFor({ state: 'visible' })
        await button(page, '整理').click(); await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 })
        evidence.autoCandidateText = await controls.textContent()
        assert.match(evidence.autoCandidateText, /环绕|闭合循环/)
        await page.getByLabel('整理动作', { exact: true }).click(); await page.getByRole('option', { name: '弹跳', exact: true }).click()
        await button(page, '整理').click(); await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 }); await shot('弹跳与原稿候选')
        await page.getByLabel('整理动作', { exact: true }).click(); await page.getByRole('option', { name: '环绕', exact: true }).click()
        await button(page, '整理').click(); await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 }); await shot('环绕与原稿候选')
        const choose = controls.getByRole('button').filter({ hasText: '沿椭圆环绕 B' }); await choose.click()
        await button(page, '应用').click()
        const applied = await saved(doc => doc.creativeIntents?.drafts[0].applications.at(-1)?.saved && doc.sequences[0].clips[0].curves?.x?.length)
        evidence.applied = applied.sequences[0].clips[0].curves
        await close(); await shot('应用后普通关键帧属性单行')
        // 位置的 X、Y 合成一行（重要记录 019）：一个秒表管整行，名称与两个读数同一行。
        const geometry = await page.locator('[data-video-edit-property-row="位置"]').evaluate(row => {
          const input = row.querySelector('input'); const name = [...row.querySelectorAll('span,div')].find(s => s.textContent === '位置')
          const rect = row.getBoundingClientRect(); const nr = name?.getBoundingClientRect(); const ir = input?.getBoundingClientRect()
          return { width: rect.width, scrollWidth: row.scrollWidth, height: rect.height, nameY: nr?.y, inputY: ir?.y }
        })
        evidence.propertyGeometry = geometry
        assert.ok(geometry.height <= 36 && geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry))
        assert.ok(Math.abs(geometry.nameY - geometry.inputY) < 12, JSON.stringify(geometry))
        const toolbar = await page.getByRole('toolbar', { name: '节目监视器控制', exact: true }).evaluate(el => ({ height: el.getBoundingClientRect().height, text: el.textContent }))
        evidence.toolbar = toolbar; assert.ok(toolbar.height <= 44, JSON.stringify(toolbar))
        // Full Electron capturePage sequence: every integer frame, both complete revolutions.
        for (let frame = 0; frame <= 240; frame++) {
          await playback(frame); await capture('orbit-frame-' + String(frame).padStart(3, '0'))
          evidence.frames.push({ frame, presented: Number(await page.getByLabel('剪辑画面', { exact: true }).getAttribute('data-presented-frame')) })
        }
        await playback(60)
        const before = JSON.stringify((await saved(doc => !!doc.sequences[0].clips[0].curves)).sequences[0].clips[0].curves)
        await page.locator('[data-video-edit-property-row="位置"]').hover()
        await button(page, '位置关键帧轨与插值').click()
        await page.getByLabel('位置插值', { exact: true }).click(); await page.getByRole('option', { name: '自定义贝塞尔', exact: true }).click()
        await page.getByRole('slider', { name: '位置缓动手柄1', exact: true }).press('ArrowRight')
        await saved(doc => JSON.stringify(doc.sequences[0].clips[0].curves) !== before)
        await shot('普通贝塞尔手动编辑')
        await page.keyboard.press('Escape')
        await button(page, '撤销').click()
        await saved(doc => JSON.stringify(doc.sequences[0].clips[0].curves) === before); await shot('撤销手动编辑')
        await button(page, '撤销').click()
        await saved(doc => !doc.sequences[0].clips[0].curves?.x); await shot('撤销整组候选')
        await panel(); await shot('窄面板与唯一主动作')
        const action = controls.getByRole('button', { name: /^(应用|整理|重试保存)$/ })
        assert.equal(await action.count(), 1)
        evidence.panelGeometry = await controls.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, text: el.textContent }))
        assert.ok(evidence.panelGeometry.scrollWidth <= evidence.panelGeometry.width + 1)
        assert.ok(!/p2-primitives|revision|条带数|主动作数量/.test(evidence.panelGeometry.text))
        await action.scrollIntoViewIfNeeded(); await shot('候选与唯一主动作完整可见')
      } catch (error) { evidence.failure = error.message; await capture('failure').catch(() => {}); throw error }
      finally { fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); await client?.close(); await disableMcp(page).catch(() => {}); await unblock() }
    } }
}
module.exports = { createVideoEditPrimitivesScene }
