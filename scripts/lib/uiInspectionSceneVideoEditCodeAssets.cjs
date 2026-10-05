const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { clickOutsideFloatingAssets, observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, saved, presented, png, pixelDifference, mediaProbe, trackBanks } = require('./uiInspectionSceneVideoEditMonitor.cjs')

const source = `export default {apiVersion:1,name:"跨工程代码资产",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:3,seed:77,parameters:{amount:{type:"number",title:"图形透明度",default:.5,min:0,max:1,step:.01,animatable:true},logo:{type:"image",title:"原图片",default:null,animatable:false},label:{type:"text",title:"标题内容",default:"跨工程代码资产",maxLength:64}},render(ctx){return [rect({x:130+ctx.time*100,y:500,width:1000,height:500,fill:[0,.6,1,ctx.params.amount]}),image({source:ctx.params.logo,x:1800,y:300,width:1000,height:600}),text({x:200,y:1500,text:ctx.params.label,fontSize:130,color:[1,1,1,1]})];}}`
const filterSource = `export default {apiVersion:1,name:"可编辑资产滤镜",kind:"filter",mode:"static",width:3840,height:2160,durationSeconds:3,seed:8,parameters:{gain:{type:"number",title:"红色强度",default:1,min:0,max:1,step:.01}},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.gain,c.g,c.b,c.a);}}`
const button = (page, name) => page.getByRole('button', { name, exact: true })
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const normalized = value => value.replaceAll('/', '\\').toLowerCase()
const checked = result => { assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert.equal(result.verificationState, 'verified', JSON.stringify(result)); return result }

function createVideoEditCodeAssetsScene() {
  return { id: 'video-edit-code-assets', surface: '剪辑', name: '剪辑-可编辑代码资产跨工程原图曲线与4K60输出', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-code-assets'); fs.mkdirSync(root, { recursive: true })
      const fixture = read(path.resolve('node_modules/.cache/video-edit-composite-edit/mixed.henji-video'))
      fixture.id = 'code-asset-source-project'; fixture.name = '代码资产原工程'; fixture.revision = 0; fixture.codeMaterials = []
      fixture.items = fixture.items.filter(item => ['video', 'audio', 'image'].includes(item.kind))
      for (const sequence of fixture.sequences) { sequence.clips = sequence.clips.filter(clip => ['video', 'audio'].includes(clip.kind)).map(clip => { const next = { ...clip }; delete next.effects; return next }); sequence.transitions = [] }
      const image = fixture.media.find(media => media.kind === 'image'); assert.ok(image)
      const originFile = path.join(root, 'source.henji-video'); fs.writeFileSync(originFile, JSON.stringify(fixture))
      const target = structuredClone(fixture); target.id = 'code-asset-target-project'; target.name = '代码资产目标工程'; target.media = target.media.filter(media => media.kind !== 'image'); target.items = target.items.filter(item => item.kind !== 'image')
      const targetFile = path.join(root, 'target.henji-video'); fs.writeFileSync(targetFile, JSON.stringify(target))
      const codePath = path.join(root, `editable-${Date.now()}.henji-code`); const filterPath = path.join(root, `filter-${Date.now()}.henji-code`); const output = path.join(root, `mixed-${Date.now()}.mp4`)
      const originals = fixture.media.map(media => ({ file: media.path, size: fs.statSync(media.path).size, mtimeMs: fs.statSync(media.path).mtimeMs }))
      const evidence = { completed: false, phases: [], captures: [], originals, program: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      let client; let previousLayout; let observed = false
      try {
        evidence.display = await app.evaluate(({ BrowserWindow, screen }, { point, hostContentsId }) => {
          const host = (BrowserWindow.getAllWindows().find(window => window.webContents.id === hostContentsId) ?? BrowserWindow.getAllWindows()[0])
          const bounds = host.getBounds(); const current = screen.getDisplayMatching(bounds); const coordinates = point?.split(',').map(Number)
          const preferred = coordinates && screen.getAllDisplays().find(display => coordinates[0] >= display.bounds.x && coordinates[0] < display.bounds.x + display.bounds.width && coordinates[1] >= display.bounds.y && coordinates[1] < display.bounds.y + display.bounds.height)
          return { bounds, id: current.id, primary: current.id === screen.getPrimaryDisplay().id, preferred: preferred?.id }
        }, { point: process.env.HENJI_DEV_DISPLAY_POINT, hostContentsId: await (await app.browserWindow(page)).evaluate((window) => window.webContents.id) })
        if (process.env.HENJI_DEV_DISPLAY_POINT) { assert.equal(evidence.display.id, evidence.display.preferred); assert.equal(evidence.display.primary, false) }
        await button(page, '剪辑').click(); if (await button(page, '关闭工程').isVisible()) await button(page, '关闭工程').click()
        await button(page, '生成').click(); previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1')); await observeWorkers(page); observed = true; await button(page, '剪辑').click()
        const open = async file => { await dialogs(app, [file], file); await button(page, '打开工程').click(); await presented(page, 0) }
        await open(originFile)
        const identity = await authorizeMcpConnection(page, { name: '代码资产真实工程验收', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji editable code assets Reality')
        const change = async changes => {
          const refs = [...new Map(changes.map(change => { const ref = change.target ?? change.parent; return [`${ref.kind}:${ref.id}`, ref] })).values()]; const baselines = []
          for (const ref of refs) baselines.push(await callTool(client, 'read_application_entity', { ref }))
          return checked(await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '验证可编辑代码资产原工程', changes })))
        }
        const project = id => ({ kind: 'video_edit.project', id })
        const seq = id => ({ kind: 'video_edit.sequence', id: `${id}:${fixture.sequences[0].id}` })
        const seek = async (id, frame) => {
          await change([{ kind: 'set_properties', entityType: 'video_edit.project', target: project(id), properties: { 'video_edit.project.program_playback': { frame, playing: false, playbackDirection: 1 } } }]); await presented(page, frame)
          const revision = read(id === fixture.id ? originFile : targetFile).revision
          await page.waitForFunction(({ frame, revision }) => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.presentedRevision === String(revision) }, { frame, revision })
        }
        const select = async clip => { await page.locator(`[data-video-edit-clip="${clip.id}"]`).getByRole('button').nth(1).click(); await page.locator(`[data-video-edit-code-parameters="${clip.id}"]`).waitFor({ state: 'visible' }) }
        await change([{ kind: 'create_items', entityType: 'video_edit.code_material', parent: project(fixture.id), items: [{ properties: { 'video_edit.code_material.source': source } }] }])
        let document = await saved(page, originFile, value => value.items.some(item => item.kind === 'code')); const item = document.items.find(item => item.kind === 'code')
        const curves = { amount: [{ id: 'asset-start', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: .35, interpolation: 'ease' }, { id: 'asset-end', sourceInUs: 2_000_000, sourceRemainder: { numerator: 1, denominator: 3 }, value: .85, interpolation: 'ease' }] }
        const parameters = { amount: .35, logo: { kind: 'image', mediaId: image.id }, label: '跨工程代码资产' }
        await change([{ kind: 'create_items', entityType: 'video_edit.clip', parent: seq(fixture.id), items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.kind': 'code', 'video_edit.clip.name': item.name, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 180, 'video_edit.clip.track': 4, 'video_edit.clip.code_parameters': parameters, 'video_edit.clip.code_curves': curves } }] }])
        document = await saved(page, originFile, value => value.sequences[0].clips.some(clip => clip.kind === 'code')); const sourceClip = document.sequences[0].clips.find(clip => clip.kind === 'code')
        for (const frame of [0, 90, 179]) { await seek(fixture.id, frame); evidence.program.push({ frame, ...await png(page, path.join(root, `source-${frame}.png`)) }) }
        await select(sourceClip); await dialogs(app, [originFile], codePath); const beforeCollect = await workerSnapshot(page); const collectAt = performance.now()
        await button(page, '代码素材加入资产库').click(); await page.locator('[data-asset-card][data-asset-kind="code"]').filter({ hasText: sourceClip.name }).waitFor({ state: 'visible', timeout: 30000 })
        evidence.collectMs = performance.now() - collectAt
        const manifest = read(codePath); assert.deepEqual(manifest.parameters, parameters); assert.deepEqual(manifest.curves, curves); assert.equal(manifest.sourceVersion.source, source); assert.equal(manifest.images.length, 1); assert.equal(manifest.images[0].path, image.path)
        assert.ok(!/"(ir|program|shader|instructions|previewUrl)"/.test(JSON.stringify(manifest)))
        const asset = await page.evaluate(async keyword => { const found = await window.henjiNative.assetLibrary.queryAssets({ keyword, mediaType: 'code', pageSize: 50 }); return window.henjiNative.assetLibrary.inspectAsset(found.items[0].id) }, sourceClip.name)
        assert.equal(asset.thumbnailUrl, null); assert.equal(normalized(asset.filePath), normalized(codePath)); assert.equal(asset.source, 'video-edit'); assert.equal(asset.inspectionStatus, 'ready')
        const afterCollect = await workerSnapshot(page); assert.equal(afterCollect.workers.length, beforeCollect.workers.length); evidence.collectResources = { before: beforeCollect, after: afterCollect }; evidence.asset = asset; evidence.manifest = manifest
        const baseline = await callTool(client, 'read_application_entity', { ref: project(fixture.id) })
        const sourceRef = { kind: 'video_edit.clip', id: `${fixture.id}:${sourceClip.id}` }; const sourceRead = await callTool(client, 'read_application_entity', { ref: sourceRef })
        const repeated = checked(await callTool(client, 'collect_video_edit_code_asset', operationEnvelope([baseline, sourceRead], { projectRef: project(fixture.id), targetRef: sourceRef })))
        assert.equal(repeated.result.data.resultRef.id, asset.id); evidence.publicCollect = repeated
        await shot('code-asset-collected-original-source'); await clickOutsideFloatingAssets(page); await button(page, '关闭工程').click(); await waitReleased(page)
        await open(targetFile); await button(page, '资产库').click(); const card = page.locator(`[data-asset-id="${asset.id}"]`); await card.waitFor({ state: 'visible' })
        const beforePreview = await workerSnapshot(page); await card.locator('.aspect-square').dblclick(); await page.locator('[data-asset-code-preview]').waitFor({ state: 'visible' }); await page.locator('[data-asset-code-import]').waitFor({ state: 'visible' })
        assert.equal((await workerSnapshot(page)).workers.length, beforePreview.workers.length, '资产清单预览不能启动GPU或编译Worker')
        const importAt = performance.now(); await page.locator('[data-asset-code-import]').click()
        document = await saved(page, targetFile, value => value.items.some(item => item.kind === 'code')); await page.getByText('已加入项目素材，可继续剪辑和调参', { exact: true }).waitFor({ state: 'visible' }); evidence.importMs = performance.now() - importAt
        await page.getByRole('dialog', { name: '可编辑代码', exact: true }).getByRole('button', { name: '可编辑代码 - 关闭', exact: true }).click()
        await clickOutsideFloatingAssets(page)
        const imported = document.items.find(item => item.kind === 'code'); const originalCount = target.media.length
        assert.equal(document.media.length, originalCount + 1); assert.notEqual(imported.code.parameters.logo.mediaId, image.id); assert.deepEqual(imported.code.curves, curves); assert.equal(imported.code.parameters.amount, .35)
        assert.equal(document.codeMaterials[0].versions[0].assetOrigin.contentIdentity, asset.contentIdentity)
        await button(page, '撤销').click(); await saved(page, targetFile, value => !value.items.some(item => item.kind === 'code') && value.media.length === originalCount && !value.codeMaterials?.length)
        await button(page, '重做').click(); await saved(page, targetFile, value => value.items.some(item => item.id === imported.id) && value.media.length === originalCount + 1)
        await page.locator(`[data-video-edit-project-entry="${imported.id}"]`).click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加到当前序列', exact: true }).click()
        document = await saved(page, targetFile, value => value.sequences[0].clips.some(clip => clip.kind === 'code')); let importedClip = document.sequences[0].clips.find(clip => clip.kind === 'code')
        await change([{ kind: 'set_properties', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: `${target.id}:${importedClip.id}` }, properties: { 'video_edit.clip.start': 0, 'video_edit.clip.duration': 180, 'video_edit.clip.track': 4 } }])
        document = await saved(page, targetFile, value => value.sequences[0].clips.find(clip => clip.id === importedClip.id).track === 4); importedClip = document.sequences[0].clips.find(clip => clip.id === importedClip.id)
        evidence.comparisons = []
        for (const expected of evidence.program) { await seek(target.id, expected.frame); const actual = await png(page, path.join(root, `target-${expected.frame}.png`)); const comparison = await pixelDifference(actual.file, expected.file); assert.ok(comparison.equal, JSON.stringify(comparison)); evidence.comparisons.push({ frame: expected.frame, comparison }) }
        await select(importedClip); const prior = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png')); const parameterAt = performance.now()
        await page.getByLabel('标题内容', { exact: true }).fill('手动资产标题'); await page.getByLabel('标题内容', { exact: true }).press('Tab')
        await saved(page, targetFile, value => value.sequences[0].clips.find(clip => clip.id === importedClip.id).code.parameters.label === '手动资产标题')
        await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]').toDataURL('image/png') !== previous, prior); evidence.parameterMs = performance.now() - parameterAt; evidence.parameterIncludesReadback = true
        const clipRef = { kind: 'video_edit.clip', id: `${target.id}:${importedClip.id}` }
        await change([{ kind: 'set_properties', entityType: clipRef.kind, target: clipRef, properties: { 'video_edit.clip.code_parameters': { ...importedClip.code.parameters, label: 'Agent 回环标题' } } }])
        document = await saved(page, targetFile, value => value.sequences[0].clips.find(clip => clip.id === importedClip.id).code.parameters.label === 'Agent 回环标题'); assert.equal(await page.getByLabel('标题内容', { exact: true }).inputValue(), 'Agent 回环标题')
        await page.waitForFunction(revision => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedRevision === String(revision), document.revision)
        const beforeReopen = await png(page, path.join(root, 'before-reopen.png')); await shot('code-asset-target-editable-mixed'); await button(page, '关闭工程').click(); await waitReleased(page); await open(targetFile); await seek(target.id, 179)
        const reopened = await png(page, path.join(root, 'after-reopen.png')); evidence.reopen = await pixelDifference(beforeReopen.file, reopened.file); assert.ok(evidence.reopen.equal)
        // A filter asset uses the public original clipRef even when another clip is selected.
        await change([{ kind: 'create_items', entityType: 'video_edit.code_material', parent: project(target.id), items: [{ properties: { 'video_edit.code_material.source': filterSource } }] }])
        document = await saved(page, targetFile, value => value.codeMaterials.length === 2); const filter = document.codeMaterials.find(definition => definition.versions[0].source === filterSource)
        await dialogs(app, [targetFile], filterPath); const filterRead = await callTool(client, 'read_application_entity', { ref: project(target.id) })
        const definitionRef = { kind: 'video_edit.code_material', id: `${target.id}:${filter.id}` }; const definitionRead = await callTool(client, 'read_application_entity', { ref: definitionRef })
        const filterCollection = checked(await callTool(client, 'collect_video_edit_code_asset', operationEnvelope([filterRead, definitionRead], { projectRef: project(target.id), targetRef: definitionRef })))
        const filterAssetRef = filterCollection.result.data.resultRef; const clipCount = document.items.length; const mediaCount = document.media.length
        const otherClip = document.sequences[0].clips.find(clip => clip.kind === 'video'); assert.ok(otherClip)
        await page.locator(`[data-video-edit-clip="${otherClip.id}"]`).getByRole('button').nth(1).click()
        const importRead = await callTool(client, 'read_application_entity', { ref: project(target.id) })
        evidence.publicFilter = checked(await callTool(client, 'import_video_edit_asset', operationEnvelope([importRead], { projectRef: project(target.id), assetRef: filterAssetRef, clipRef })))
        document = await saved(page, targetFile, value => value.sequences[0].clips.find(clip => clip.id === importedClip.id).effects?.length === 1); assert.equal(document.items.length, clipCount); assert.equal(document.media.length, mediaCount); assert.equal(document.sequences[0].clips.find(clip => clip.id === otherClip.id).effects?.length ?? 0, 0)
        await page.waitForFunction(revision => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedRevision === String(revision), document.revision)
        const finalPreview = await png(page, path.join(root, 'final-preview-179.png')); await dialogs(app, [targetFile], output); const exportAt = performance.now(); await button(page, '导出视频').click()
        let task
        for (let attempt = 0; attempt < 2400; attempt++) { task = await callTool(client, 'query_video_edit_export', { projectRef: project(target.id) }); if (['completed', 'failed', 'cancelled'].includes(task.data.task?.state)) break; await page.waitForTimeout(50) }
        assert.equal(task.data.task?.state, 'completed', JSON.stringify(task)); const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs'); const metadata = mediaProbe(ffprobePath, output); const video = metadata.streams.find(stream => stream.codec_type === 'video')
        assert.equal(video.width, 3840); assert.equal(video.height, 2160); assert.equal(video.avg_frame_rate, '60/1'); assert.equal(Number(video.nb_frames), 180); assert.ok(metadata.streams.some(stream => stream.codec_type === 'audio'))
        const decoded = path.join(root, 'export-179.png'); execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', output, '-vf', 'select=eq(n\\,179)', '-frames:v', '1', decoded], { windowsHide: true, timeout: 60000 })
        const comparison = await pixelDifference(decoded, finalPreview.file); assert.ok(comparison.psnr === null || comparison.psnr >= 30, JSON.stringify(comparison)); evidence.export = { path: output, milliseconds: performance.now() - exportAt, metadata, comparison }
        evidence.trackBanks = await trackBanks(page); await shot('code-asset-original-image-curves-filter-export'); await button(page, '关闭工程').click(); await waitReleased(page)
        for (const original of originals) { const stat = fs.statSync(original.file); assert.equal(stat.size, original.size); assert.equal(stat.mtimeMs, original.mtimeMs) }
        evidence.originalsUnchanged = true; evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0); evidence.completed = true; store()
      } catch (error) { evidence.failed = { message: String(error.message ?? error), stack: error.stack }; store(); await shot('code-assets-failed').catch(() => {}); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        if (await button(page, '关闭工程').isVisible().catch(() => false)) await button(page, '关闭工程').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.completed = false; evidence.releaseFailure = String(error) }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(previous => { window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker; if (previous === null) localStorage.removeItem('henji.videoEdit.dockLayout.v1'); else if (typeof previous === 'string') localStorage.setItem('henji.videoEdit.dockLayout.v1', previous) }, previousLayout).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditCodeAssetsScene }
