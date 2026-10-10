/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 的无付费供应商边界夹具。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')
const { queryApplicationLogs } = require('./runtimeEvidence.cjs')

function createImageEditAiWorkflowsScene(context) {
  return {
    id: 'image-edit-ai-workflows', surface: '图片编辑', name: 'AI 主体候选、模型修补确认与原地扩图恢复', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    expectedLogEvents: ['image_edit.repair.failed', 'image_edit.outpaint.failed', 'generation.generate.failed', 'visible_generation.execute.failed', 'generation.task.failed', 'image_edit.v3.persistence.confirm.failed', 'image_edit.v3.persistence.save.failed', 'image_edit.v3.document.autosave.failed', 'error.event'],
    setup: async (page, app, { capture }) => {
      const sceneStartedAt = new Date().toISOString()
      const restorePaid = await blockPaidGeneration(app)
      const { encodeImageEditSelectionMaskV3 } = loadTypeScript('src/core/imageEdit/v3/subjectSelection.ts')
      const candidates = [0, 1].map(index => ({ id: String(index + 1), score: .9, area: .16,
        bounds: { x: .15 + index * .5, y: .2, width: .2, height: .6 },
        mask: encodeImageEditSelectionMaskV3(Uint8Array.from({ length: 256 }, (_, i) => {
          const x = i % 16, y = Math.floor(i / 16); return x >= 2 + index * 8 && x < 6 + index * 8 && y >= 3 && y < 13 ? 255 : 0
        }), 16, 16) }))
      const channels = ['ai:getRuntimeProviderKeyStatus', 'ai:generate', 'imageEditorV3:selection:infer', 'imageEditorV3:repair:run', 'imageEditorV3:document:save']
      await app.evaluate(({ ipcMain }, payload) => {
        const originals = new Map(payload.channels.map(channel => [channel, ipcMain._invokeHandlers.get(channel)]))
        globalThis.__imageAiFixture = { originals, mode: 'hold', pending: [], requests: [], saveFault: false }
        const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
        replace('ai:getRuntimeProviderKeyStatus', () => ({ ok: true, data: [{ providerId: 'kie', configured: true }] }))
        replace('ai:generate', async (_event, request) => {
          const fixture = globalThis.__imageAiFixture
          fixture.requests.push(request)
          if (fixture.mode === 'failure') return { ok: false, error: { code: 'FIXTURE_FAILURE', message: '扩图供应商模拟失败，原图片保持不变' } }
          if (fixture.mode === 'success') return { ok: true, data: { status: 'completed', urls: [payload.image], filePaths: [payload.image] } }
          return await new Promise(resolve => fixture.pending.push(resolve))
        })
        replace('imageEditorV3:selection:infer', async () => ({ ok: true, data: { model: 'efficienttam', providers: ['fixture'], durationMs: 1, inferenceMs: 1, candidates: payload.candidates } }))
        replace('imageEditorV3:repair:run', async (event, request) => {
          const sharp = process.getBuiltinModule('node:module').createRequire(payload.projectPackage)('sharp')
          const pixels = Buffer.from(request.rgba)
          for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 100; pixels[i + 1] = 140; pixels[i + 2] = 180; pixels[i + 3] = 255 }
          const bytes = await sharp(pixels, { raw: { width: request.width, height: request.height, channels: 4 } }).png().toBuffer()
          const ingest = ipcMain._invokeHandlers.get('imageEditorV3:source:ingest')
          const output = await ingest(event, { requestId: `fixture-repair-${Date.now()}`, source: { kind: 'data-url', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } })
          if (!output.ok) throw new Error('修补夹具资源写入失败')
          return { ok: true, data: { patch: output.data.resource, durationMs: 1 } }
        })
        replace('imageEditorV3:document:save', (event, request) => {
          const fixture = globalThis.__imageAiFixture
          if (fixture.saveFault && !request.document.id.includes('outpaint-reference')) { fixture.saveFault = false; return { ok: false, error: { code: 'FIXTURE_SAVE_FAILURE', message: '扩图保存模拟失败，请恢复原任务' } } }
          return originals.get('imageEditorV3:document:save')(event, request)
        })
      }, { channels, candidates, projectPackage: path.resolve('package.json'), image: path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png') })
      let host = page.locator('[data-image-editor-v3]:visible').last()
      const shoot = async name => {
        await context.settlePage(page, 650)
        assert.equal(await host.locator('[data-command-bar]').count(), 1)
        assert.ok(await host.locator('[data-context-bar]').count() <= 1)
        await capture(name)
      }
      const repairTool = async name => { await host.getByRole('button', { name: '修饰', exact: true }).click(); await page.getByRole('menuitem', { name, exact: true }).click() }
      const selectionTool = async name => { await host.locator('[data-tool-id^="select-"]').click(); await page.getByRole('menuitem', { name, exact: true }).click() }
      const revision = async () => Number(await host.locator('[data-command-bar]').getAttribute('data-document-revision'))
      const setMode = async (mode, release = false, saveFault = false) => app.evaluate((_electron, values) => {
        const fixture = globalThis.__imageAiFixture; fixture.mode = values.mode; fixture.saveFault = values.saveFault
        if (values.release) for (const resolve of fixture.pending.splice(0)) resolve(values.mode === 'success'
          ? { ok: true, data: { status: 'completed', urls: [values.image], filePaths: [values.image] } }
          : { ok: false, error: { code: 'FIXTURE_CANCELLED', message: '夹具生成已取消' } })
      }, { mode, release, saveFault, image: path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png') })
      const configure = async () => {
        await repairTool('AI 扩图'); await host.getByRole('button', { name: '设置扩图', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'AI 扩图', exact: true })
        await dialog.waitFor(); return dialog
      }
      const submit = async () => {
        const previousCount = await app.evaluate(() => globalThis.__imageAiFixture.requests.length)
        const dialog = await configure()
        await dialog.getByTitle('更换生成模型', { exact: true }).click()
        await page.locator('[data-model-id="kie-nano-banana-pro"]').click()
        await dialog.getByRole('button', { name: '开始扩图', exact: true }).click()
        const confirmation = page.getByRole('alertdialog', { name: '确认扩图费用', exact: true });
        try { await confirmation.waitFor({ timeout: 15000 }) }
        catch (error) { await shoot('outpaint-preflight-diagnostic'); throw new Error(`扩图确认未显示：${await dialog.innerText()}`, { cause: error }) }
        await shoot('outpaint-fee-confirmation')
        await confirmation.getByRole('button', { name: '确认费用并生成', exact: true }).click()
        await dialog.waitFor({ state: 'hidden', timeout: 60000 })
        const until = Date.now() + 60000
        while (await app.evaluate(() => globalThis.__imageAiFixture.requests.length) === previousCount) {
          assert.ok(Date.now() < until, '扩图未进入模拟供应商边界')
          await context.settlePage(page, 100)
        }
      }
      try {
        await host.waitFor({ timeout: 30000 }); await selectionTool('点选主体'); await host.getByRole('button', { name: '选择主体', exact: true }).click()
        await host.getByRole('button', { name: '选择候选', exact: true }).waitFor(); await shoot('subject-multiple-candidates')
        await host.getByRole('button', { name: '选择候选', exact: true }).click(); await shoot('subject-candidate-picker')
        await page.getByRole('button', { name: /候选 1 · 占画面/ }).click(); await page.keyboard.press('Escape'); await shoot('subject-selected')
        await selectionTool('画笔选区'); await host.getByRole('button', { name: '添加', exact: true }).click()
        const selection = host.locator('[data-tool-overlay-slot="selection"] svg'), box = await selection.boundingBox(); assert.ok(box)
        await page.mouse.move(box.x + box.width * .35, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .46, box.y + box.height * .5, { steps: 6 }); await page.mouse.up(); await shoot('subject-manual-refinement')
        await repairTool('移除'); await host.getByRole('button', { name: '精细', exact: true }).click()
        const before = await revision(); await host.getByRole('button', { name: '移除选区内容', exact: true }).click()
        await host.getByRole('button', { name: '应用', exact: true }).waitFor({ timeout: 60000 }); assert.equal(await revision(), before); await shoot('model-repair-preview')
        await host.getByRole('button', { name: '取消处理', exact: true }).click(); await shoot('model-repair-cancelled'); assert.equal(await revision(), before)
        await host.getByRole('button', { name: '移除选区内容', exact: true }).click(); await host.getByRole('button', { name: '应用', exact: true }).waitFor({ timeout: 60000 })
        await host.getByRole('button', { name: '应用', exact: true }).click()
        await page.waitForFunction(value => Number(Array.from(document.querySelectorAll('[data-image-editor-v3] [data-command-bar]')).filter(element => element.checkVisibility()).at(-1)?.getAttribute('data-document-revision')) === value, before + 1, { timeout: 60000 })
        assert.equal(await revision(), before + 1); await shoot('model-repair-applied')
        await host.getByRole('button', { name: '撤销', exact: true }).click()
        await page.waitForFunction(value => Number(Array.from(document.querySelectorAll('[data-image-editor-v3] [data-command-bar]')).filter(element => element.checkVisibility()).at(-1)?.getAttribute('data-document-revision')) === value, before + 2, { timeout: 60000 })
        assert.equal(await revision(), before + 2); await shoot('model-repair-one-undo')
        const configuration = await configure(); await shoot('outpaint-empty-configuration'); await configuration.getByRole('button', { name: '关闭', exact: true }).click()
        await setMode('hold'); await submit(); await host.locator('[data-outpaint-status]').waitFor(); await shoot('outpaint-generating-placeholder')
        await host.getByRole('button', { name: '取消扩图', exact: true }).click(); await setMode('failure', true); await context.settlePage(page, 600); await shoot('outpaint-cancelled-original')
        await submit(); await host.locator('[data-outpaint-status]').getByText(/模拟失败/).waitFor({ timeout: 60000 }); await shoot('outpaint-failed-recoverable')
        await host.getByRole('button', { name: '取消扩图', exact: true }).click()
        await setMode('hold'); await submit(); await shoot('outpaint-current-document-placeholder')
        await setMode('success', true, true); await host.locator('[data-outpaint-status]').getByText(/保存未确认/).waitFor({ timeout: 60000 }); await shoot('outpaint-placed-save-failed')
        const submittedCount = await app.evaluate(() => globalThis.__imageAiFixture.requests.length)
        await host.getByRole('button', { name: '恢复原任务', exact: true }).click(); await host.locator('[data-outpaint-status]').waitFor({ state: 'hidden', timeout: 60000 })
        assert.equal(await app.evaluate(() => globalThis.__imageAiFixture.requests.length), submittedCount, '恢复保存不能重新付费提交')
        await host.locator('[data-dock-tab="layers"] > span').first().click(); await host.getByText('AI 扩图', { exact: true }).last().waitFor(); await shoot('outpaint-smart-layer-landed')
        await host.getByRole('button', { name: '撤销', exact: true }).click(); await shoot('outpaint-one-undo-original')
        const canvas = await openCanvasImageEditorV3Fixture({ page, context, width: 512, height: 384, label: 'AI 共核画布宿主' }); host = canvas.editor
        await repairTool('AI 扩图'); await shoot('canvas-outpaint-host')
        await canvas.dialog.getByRole('button', { name: '关闭编辑器', exact: true }).click()
        await page.evaluate(async ({ ref, projectId, nodeId }) => {
          const api = window.henjiNative.imageEditorV3, snapshot = await api.loadDocument({ requestId: `hdr-read-${crypto.randomUUID()}`, documentRef: ref })
          snapshot.document.color.workingSpace = 'display-p3'; snapshot.document.revision++
          const saved = await api.saveDocument({ requestId: `hdr-save-${crypto.randomUUID()}`, document: snapshot.document, expectedRevision: snapshot.revision, history: null,
            resourceRefs: snapshot.resources.map(resource => resource.resourceRef), previewRef: null })
          const project = await window.henjiNative.testFixtures.readCanvas(projectId)
          const node = project.nodes.find(value => value.id === nodeId); node.data.imageEditSession.revision = saved.revision
          await window.henjiNative.testFixtures.writeCanvas(projectId, { nodes: project.nodes })
        }, { ref: canvas.fixture.documentRef, projectId: canvas.projectId, nodeId: canvas.fixture.nodeId })
        // 换色域通过正式存储重新打开，不能靠 DOM 替换伪造 HDR 错误状态。
        await context.reopenCanvasProjectFromStorage(page, canvas.projectId)
        await page.locator(`[data-layer-stack-node-id="${canvas.fixture.nodeId}"]`).dblclick(); host = page.locator('[data-image-editor-v3]:visible').last(); await host.waitFor()
        const restricted = await configure(); await restricted.getByRole('button', { name: '开始扩图', exact: true }).click(); await restricted.getByText(/宽色域与 HDR/).waitFor(); await shoot('outpaint-wide-color-hdr-explicit-rejection')
        await restricted.getByRole('button', { name: '关闭', exact: true }).click()
        // 存量生成宿主使用通用 error.event；只接受本场景固定的供应商故障，不放过其它同名错误。
        const logs = await queryApplicationLogs(page, { afterTimestamp: sceneStartedAt, endTimestamp: new Date().toISOString(), level: 'error' })
        for (const event of logs.events.filter(value => value.event === 'error.event')) {
          assert.equal(event.domain, 'workspaces.GenerationWorkspace.hooks.useTaskGeneration')
          assert.match(event.error?.message ?? '', /扩图供应商模拟失败|夹具生成已取消/)
        }
      } catch (error) {
        await capture('workflow-diagnostic')
        throw new Error(`${error.message}\n当前界面：${(await page.locator('body').innerText()).slice(-5000)}`, { cause: error })
      } finally {
        await app.evaluate(({ ipcMain }) => {
          const fixture = globalThis.__imageAiFixture; if (!fixture) return
          for (const resolve of fixture.pending) resolve({ ok: false, error: { code: 'FIXTURE_CANCELLED', message: '验收已结束' } })
          for (const [channel, handler] of fixture.originals) { ipcMain.removeHandler(channel); if (handler) ipcMain.handle(channel, handler) }
          delete globalThis.__imageAiFixture
        })
        await restorePaid()
      }
    },
  }
}
module.exports = { createImageEditAiWorkflowsScene }
