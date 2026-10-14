const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

function createRecordingProductsScene() {
  return { id: 'recording-products', name: '录制多产物-真实采集图文动图报告图片编辑', surface: '屏幕录制', writesUserData: true,
    launchArgs: ['--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const base = path.resolve('node_modules/.cache/recording-products'), root = path.join(base, `run-${Date.now()}`); fs.mkdirSync(root, { recursive: true })
      fs.writeFileSync(path.join(base, 'latest.json'), JSON.stringify({ root }, null, 2))
      const evidence = { source: 'Real recording of isolated Henji application window; deterministic step/cursor/privacy annotations; no paid calls or real devices' }
      const writeEvidence = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const button = name => page.getByRole('button', { name, exact: true })
      let client
      try {
        await button('工具').click(); await page.getByText('屏幕录制', { exact: true }).first().click()
        const sourceId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('view=')).getMediaSourceId())
        const source = (await page.evaluate(() => window.henjiNative.screenRecording.sources())).find(source => source.id === sourceId)
        assert(source, '必须录制隔离应用本身')
        await button(source.name).click(); await page.getByLabel('会话名称', { exact: true }).fill('多产物真实采集验收')
        await page.getByRole('switch', { name: '麦克风', exact: true }).click()
        await button('开始录制').click(); await button('暂停').waitFor({ timeout: 30000 })
        await page.getByLabel('标记备注', { exact: true }).fill('创建图文步骤')
        await button('打标记').click(); await page.waitForTimeout(6500)
        await page.getByLabel('标记备注', { exact: true }).fill('定位错误并导出报告')
        await button('打标记').click(); await page.waitForTimeout(6500)
        await button('停止并保存').click(); await button('生成成片').waitFor({ timeout: 30000 })
        const session = (await page.evaluate(() => window.henjiNative.documents.listDocuments({ kind: 'screen_recording', includeDrafts: true }))).find(document => document.name === '多产物真实采集验收')
        assert(session)
        const recorded = await page.evaluate(id => window.henjiNative.documents.readDocument({ id }), session.id)
        fs.writeFileSync(path.join(root, 'recorded.json'), JSON.stringify(recorded, null, 2))
        const content = recorded.content, screen = content.media.find(media => media.kind === 'screen')
        assert(screen && screen.durationUs > 12e6)
        const begin = screen.monoUs, end = begin + screen.durationUs, middle = begin + Math.floor(screen.durationUs / 2)
        // Official collector/serializer, with synthetic pointer facts. The underlying movie is real capture.
        const { CaptureLogCollector } = require('../check-persistence-compat.cjs').loadTypeScript('src/core/captureLog/collector.ts')
        const pages = [], collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id: session.id }, sourceDigest: `sha256:${'d'.repeat(64)}`, originUs: 0, id: randomUUID }, async page => { pages.push(page) }, error => { throw error })
        collector.start(begin)
        for (let index = 0; index < 12; index++) {
          const at = begin + index * 1e6, point = index < 6 ? [600, 240] : [1350, 600]
          collector.record(at, { kind: 'cursor', point, shape: 'arrow' })
          if (index === 1 || index === 8) { collector.record(at + 1000, { kind: 'click', point, button: 'left', phase: 'down' }); collector.record(at + 101000, { kind: 'click', point, button: 'left', phase: 'up' }) }
          await collector.flush()
        }
        await collector.stop(end)
        content.eventPages = pages.map((page, index) => {
          const bytes = Buffer.from(JSON.stringify(page)), hash = createHash('sha256').update(bytes).digest('hex'), file = path.join(root, `page-${index}-${hash}.capture.json`)
          fs.writeFileSync(file, bytes); return { path: file, firstSequence: page.seqSpan[0], lastSequence: page.seqSpan[1] }
        })
        content.understanding.steps = [
          { id: 'first', startUs: begin, endUs: middle, title: '准备录制与添加标记', description: '选择本应用窗口，记录操作并添加步骤标记。', signal: 'start', eventIds: [] },
          { id: 'second', startUs: middle, endUs: end, title: '定位错误与交付报告', description: '回看错误步骤，并保留最后的实际画面与应用日志。', signal: 'marker', eventIds: [] },
        ]
        content.understanding.privacy.candidates = [{ id: 'confirmed', mediaId: screen.id, kind: 'email', hint: '邮箱', fingerprint: 'a'.repeat(64), startUs: begin, endUs: end, status: 'accepted', samples: [{ monoUs: begin, box: [.04, .08, .7, .12], confidence: 1 }] }]
        await page.evaluate(async ({ id, revision, content }) => window.henjiNative.documents.saveDocument({ target: { id }, expectedRevision: revision, content }), { id: session.id, revision: recorded.meta.revision, content })
        client = await connectMcpClient((await authorizeMcpConnection(page, { name: '多产物隔离验收', allowWrites: true, allowDestructive: true })).config)
        await callTool(client, 'open_document', operationEnvelope([], { documentId: session.id }))
        await button('导出所选产物').scrollIntoViewIfNeeded(); await capture('recording-products-options')
        // Only the trusted native chooser is replaced. Real UI/service/renderer/fs remain unchanged.
        const selected = path.join(root, 'chosen'); fs.mkdirSync(selected, { recursive: true })
        await app.evaluate(({ dialog }, selected) => { global.__recordingProductsChooser = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, selected)
        await button('导出所选产物').click()
        await page.waitForFunction(() => document.body.textContent.includes('已导出并核对 2 步') || [...document.querySelectorAll('[role="alert"]')].some(node => node.textContent.trim()), null, { timeout: 120000 })
        assert(!(await page.getByRole('alert').allTextContents()).filter(text => text.trim()).length, (await page.getByRole('alert').allTextContents()).join('\n'))
        await app.evaluate(({ dialog }) => { dialog.showOpenDialog = global.__recordingProductsChooser; delete global.__recordingProductsChooser })
        const directory = path.join(selected, fs.readdirSync(selected).find(name => name.startsWith('录制-steps-')))
        const md = fs.readFileSync(path.join(directory, 'steps.md'), 'utf8'), html = fs.readFileSync(path.join(directory, 'steps.html'), 'utf8')
        assert(md.includes('准备录制与添加标记') && md.includes('定位错误与交付报告')); assert(html.includes('step-002.png'))
        const png = await require('sharp')(path.join(directory, 'step-001.png')).metadata(); assert.equal(png.width, 1920); assert.equal(png.height, 1080)
        fs.copyFileSync(path.join(directory, 'step-001.png'), path.join(root, 'guide-frame.png'))
        // Render the exported HTML in this isolated Electron process, with a sandbox and no Node/preload.
        const htmlShot = await app.evaluate(async ({ BrowserWindow }, file) => {
          const window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
          try {
            await window.loadFile(file)
            const facts = await window.webContents.executeJavaScript('Promise.all([...document.images].map(image => image.decode())).then(() => ({ titles: [...document.querySelectorAll("h2")].map(node => node.textContent), images: [...document.images].map(image => ({width:image.naturalWidth,height:image.naturalHeight})) }))')
            const image = await window.webContents.capturePage()
            return { facts, png: image.toPNG().toString('base64') }
          } finally { window.destroy() }
        }, path.join(directory, 'steps.html'))
        assert.equal(htmlShot.facts.titles.length, 2); assert(htmlShot.facts.images.every(image => image.width === 1920 && image.height === 1080))
        fs.writeFileSync(path.join(root, 'html-document.png'), Buffer.from(htmlShot.png, 'base64'))
        evidence.steps = { directory, files: fs.readdirSync(directory) }; writeEvidence()
        const sessionRef = { kind: 'screen_recording.session', id: session.id }
        const outputs = await page.evaluate(() => window.henjiNative.paths.appDirectories())
        for (const product of ['gif', 'bug_report', 'image_document']) {
          const execution = await callTool(client, 'export_screen_recording_product', operationEnvelope([], { sessionRef, product, stepIds: ['second'] }))
          assert.equal(execution.executionState, 'completed', JSON.stringify(execution))
          const result = execution.result.data
          assert(result.verified && result.state === 'completed', JSON.stringify(result))
          const read = (await callTool(client, 'read_application_entity', { ref: result.resultRef, propertyIds: ['screen_recording.export.phase', 'screen_recording.export.details'] })).data
          assert.equal(read.properties['screen_recording.export.phase'], 'completed')
          const outputDir = path.join(outputs.folders.exports, `录制-${product}-${result.resultRef.id}`)
          evidence[product] = { result, outputDir, read }; writeEvidence()
          if (product === 'gif') {
            const file = path.join(outputDir, 'step-001.gif'), { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
            const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }))
            assert(probe.streams[0].nb_read_frames > 1); assert.equal(probe.streams[0].width, 640)
            execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-y', path.join(root, 'gif-first.png')], { windowsHide: true })
            fs.copyFileSync(file, path.join(root, 'step.gif')); evidence.gif.probe = probe
          }
          if (product === 'bug_report') {
            const report = fs.readFileSync(path.join(outputDir, 'report.md'), 'utf8'); assert(report.includes('定位错误与交付报告')); assert(report.includes('应用日志片段'))
            assert(!report.includes('未找到录制与应用日志'), report); fs.copyFileSync(path.join(outputDir, 'report.md'), path.join(root, 'report.md'))
          }
          if (product === 'image_document') {
            assert.equal(result.documentRefs.length, 1)
            const imageId = result.documentRefs[0].id
            const snapshot = await page.evaluate(documentRef => window.henjiNative.imageEditorV3.loadDocument({ requestId: crypto.randomUUID(), documentRef }), `image-edit-v3:${imageId}`)
            assert.deepEqual(snapshot.document.layers.map(layer => layer.type), ['shape', 'raster', 'text', 'text'])
            const { BLACK_HEX } = require('../check-persistence-compat.cjs').loadTypeScript('src/core/theme/colorTokens.ts')
            assert(snapshot.document.layers.slice(2).every(layer => layer.content.paragraphs[0].runs[0].style.fill.enabled && layer.content.paragraphs[0].runs[0].style.fill.color === BLACK_HEX), '白色纸面上的标题和说明必须可见')
            await callTool(client, 'open_document', operationEnvelope([], { documentId: imageId }))
            await page.locator('[data-image-editor-v3]').first().waitFor({ timeout: 60000 })
            await page.waitForFunction(() => document.querySelector('[data-preview-output-width="1024"]'), null, { timeout: 60000 })
            await page.waitForTimeout(2500); await page.screenshot({ path: path.join(root, 'image-document.png') }); await capture('recording-products-image-document')
            assert(!(await page.getByRole('alert').allTextContents()).filter(text => text.trim()).length)
          }
        }
        // Full terminal audit belongs to this task's recording surface; the existing editor was captured above.
        await callTool(client, 'open_document', operationEnvelope([], { documentId: session.id }))
        await button('导出所选产物').scrollIntoViewIfNeeded()
        evidence.completed = true; writeEvidence()
      } finally { writeEvidence(); if (client) await client.close().catch(() => undefined); await disableMcp(page).catch(() => undefined) }
    },
  }
}
module.exports = { createRecordingProductsScene }
