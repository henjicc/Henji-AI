const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { openVideoEditFile, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

const PROJECT_ID = 'video-edit-styles'
/** 待验收的风格包：默认是本任务生成的“节点光迹”，可用 HENJI_STYLE_PACKAGE 换成别的 .henjistyle。 */
const PACKAGE = process.env.HENJI_STYLE_PACKAGE || path.resolve('node_modules/.cache/video-edit-styles-input/节点光迹.henjistyle')
const BUILTIN = ['restrained', 'tech-info', 'explainer', 'variety', 'promo', 'warm-documentary']
const button = (page, name) => page.getByRole('button', { name, exact: true })

function fixture() {
  const track = (index, kind, name) => ({ id: `${kind[0]}${index}`, name, index, kind, locked: false, enabled: true, muted: false, solo: false })
  return { format: 'henji-video-project', version: 5, id: PROJECT_ID, name: '风格与模板', revision: 0, media: [], bins: [], items: [],
    sequences: [{ id: 'main', name: '序列 1', width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [track(0, 'audio', '音频 1'), track(1, 'video', '视频 1'), track(2, 'video', '视频 2')], clips: [], annotations: [] }] }
}

/**
 * 风格与模板真实验收（隔离资料目录）：风格面板六张内置卡片与放大详情；从界面导入 .henjistyle（只解析保存）；
 * 用正式渲染器渲染导入风格与内置风格副本的样片（预览、缩略图、锚点帧）；右键绑定到序列；
 * 模板面板单击应用与拖入时间线、改参数、分离；导出再比对往返内容。每步截图供目视。
 */
function createVideoEditStylesScene() {
  return { id: 'video-edit-styles', surface: '剪辑', name: '剪辑-风格卡片导入渲染与模板应用', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-styles'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(path.join(root, 'rendered'), { recursive: true })
      assert.ok(fs.existsSync(PACKAGE), `缺少风格包：${PACKAGE}`)
      const file = path.join(root, 'styles.henji-video'); fs.writeFileSync(file, JSON.stringify(fixture()))
      const evidence = { completed: false, startedAt: new Date().toISOString(), package: PACKAGE, steps: {} }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const documentRef = { kind: 'video_edit.document', id: PROJECT_ID }; const sequenceRef = { kind: 'video_edit.sequence', id: `${PROJECT_ID}:main` }
      let client
      const tool = async (name, args, baselineRefs = []) => {
        const baselines = []; for (const ref of baselineRefs) baselines.push(await callTool(client, 'read_application_entity', { ref }))
        const result = await callTool(client, name, baselineRefs.length || !['list_application_entities', 'read_application_entity'].includes(name) ? operationEnvelope(baselines, args) : args)
        return result
      }
      const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, ...(propertyIds ? { propertyIds } : {}) })
      const dock = async title => {
        const tab = page.locator('.dv-tab').filter({ has: page.getByText(title, { exact: true }) }).first()
        if (await tab.isVisible()) await tab.click(); else { await button(page, '面板').click(); await button(page, title).click() }
      }
      const savedProject = async matches => { for (let i = 0; i < 300; i++) { const value = readVideoEditFile(file); if (matches(value)) return value; await page.waitForTimeout(100) } return assert.fail(`剪辑没有保存成期望状态：${JSON.stringify(readVideoEditFile(file).templates ?? null)}`) }
      try {
        await button(page, '剪辑').first().click(); if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await dialogs(app, [file], file); await openVideoEditFile(page, file); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '风格与模板', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji styles Reality')

        // 1. 风格面板：六张内置卡片都显示渲染好的缩略图。
        await dock('风格')
        const cards = page.locator('[data-video-edit-style]')
        await page.waitForFunction(count => document.querySelectorAll('[data-video-edit-style] img').length >= count && [...document.querySelectorAll('[data-video-edit-style] img')].every(img => img.complete && img.naturalWidth > 0), BUILTIN.length, { timeout: 30000 })
        evidence.steps.grid = { ids: await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-video-edit-style'))) }
        assert.deepEqual(evidence.steps.grid.ids, BUILTIN, '内置风格卡片不全或顺序不对')
        evidence.steps.grid.capture = await capture('styles-01-grid')
        // 2. 单击放大：样片预览视频在播，锚点帧与说明书栏目在详情里。
        await page.locator('[data-video-edit-style="variety"]').click()
        const detail = page.locator('[data-video-edit-style-detail="variety"]'); await detail.waitFor({ state: 'visible' })
        await page.waitForFunction(() => { const video = document.querySelector('[data-video-edit-style-detail] video'); return video && video.readyState >= 2 && video.currentTime > 0.3 }, null, { timeout: 30000 })
        evidence.steps.detail = { anchors: await detail.locator('[aria-label^="锚点帧"]').count(), sections: await detail.getByText('不变量与自由度', { exact: true }).count(), capture: await capture('styles-02-detail') }
        assert.equal(evidence.steps.detail.anchors, 5)
        await page.keyboard.press('Escape'); await detail.waitFor({ state: 'hidden' })

        // 3. 从界面导入风格包（系统对话框替换为固定路径）：只解析和保存，新卡片出现在个人风格最前面。
        const exported = path.join(root, '导出往返.henjistyle')
        await dialogs(app, [PACKAGE], exported)
        await button(page, '导入风格包').click()
        const source = JSON.parse(fs.readFileSync(PACKAGE, 'utf8')).content
        const imported = page.locator(`[data-video-edit-style="${source.style.id}"]`)
        await page.locator(`[data-video-edit-style-detail="${source.style.id}"]`).waitFor({ state: 'visible', timeout: 30000 })
        evidence.steps.import = { capture: await capture('styles-03-imported-detail') }
        await page.keyboard.press('Escape')
        await imported.waitFor({ state: 'visible' })
        const style = await read({ kind: 'video_edit.style', id: source.style.id }, ['video_edit.style.version', 'video_edit.style.imported', 'video_edit.style.template_refs', 'video_edit.style.stale'])
        evidence.steps.import.read = style.data.properties
        assert.equal(style.data.properties['video_edit.style.imported'], true); assert.equal(style.data.properties['video_edit.style.stale'], false)
        assert.equal(style.data.properties['video_edit.style.template_refs'].length, source.templates.length)

        // 4. 正式渲染器渲染导入风格的样片；内容没变，版本不变。再把内置风格逐套复制成个人风格渲染，留出痕迹AI自己的预览与锚点帧。
        const rendered = await tool('render_video_edit_style', { styleRef: { kind: 'video_edit.style', id: source.style.id } })
        assert.equal(rendered.verificationState, 'verified', JSON.stringify(rendered))
        evidence.steps.render = { imported: rendered.result?.data ?? rendered }
        assert.equal(evidence.steps.render.imported.version, source.style.version); assert.equal(evidence.steps.render.imported.changed, false)
        const copyMedia = (name, media) => { fs.mkdirSync(path.join(root, 'rendered', name, 'anchors'), { recursive: true }); fs.copyFileSync(media.preview, path.join(root, 'rendered', name, 'preview.mp4')); fs.copyFileSync(media.thumbnail, path.join(root, 'rendered', name, 'thumbnail.jpg')); media.anchors.forEach((anchor, index) => fs.copyFileSync(anchor, path.join(root, 'rendered', name, 'anchors', `${String(index + 1).padStart(2, '0')}.jpg`))) }
        copyMedia(source.style.id, evidence.steps.render.imported.media)
        evidence.steps.render.builtin = {}
        for (const id of BUILTIN) {
          const builtin = await read({ kind: 'video_edit.style', id }, ['video_edit.style.name', 'video_edit.style.guide', 'video_edit.style.sample', 'video_edit.style.description'])
          const props = builtin.data.properties
          const created = await tool('change_application_entities', { summary: '复制内置风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style', parent: documentRef, items: [{ properties: { 'video_edit.style.name': `${props['video_edit.style.name']} 渲染`, 'video_edit.style.description': props['video_edit.style.description'], 'video_edit.style.guide': props['video_edit.style.guide'], 'video_edit.style.sample': props['video_edit.style.sample'] } }] }] }, [documentRef])
          const copyRef = (created.result?.data?.resultRefs ?? created.data?.resultRefs ?? []).find(ref => ref.kind === 'video_edit.style')
          assert.ok(copyRef, JSON.stringify(created))
          const started = Date.now(); const result = await tool('render_video_edit_style', { styleRef: copyRef })
          assert.equal(result.verificationState, 'verified', `${id} 渲染失败：${JSON.stringify(result)}`)
          const data = result.result?.data ?? result
          evidence.steps.render.builtin[id] = { ms: Date.now() - started, version: data.version, warnings: data.warnings, media: data.media }
          copyMedia(id, data.media); store()
        }
        await dock('风格'); evidence.steps.render.capture = await capture('styles-04-rendered-grid')

        // 5. 右键菜单：绑定到当前序列、导出风格包。
        await imported.click({ button: 'right' })
        await page.getByRole('menuitem', { name: '绑定到当前序列' }).click()
        const bound = await savedProject(value => value.sequences[0].styleId === source.style.id)
        evidence.steps.bind = { styles: bound.styles.map(value => [value.id, value.version]), capture: await capture('styles-05-bound') }
        await imported.click({ button: 'right' })
        await page.getByRole('menuitem', { name: '导出风格包…' }).click()
        for (let i = 0; i < 100 && !fs.existsSync(exported); i++) await page.waitForTimeout(100)
        const roundTrip = JSON.parse(fs.readFileSync(exported, 'utf8')).content
        evidence.steps.export = { bytes: fs.statSync(exported).size, templates: roundTrip.templates.length }
        assert.deepEqual({ ...roundTrip.style, updatedAt: '' }, { ...source.style, imported: true, updatedAt: '' }, '导出的风格与导入的不一致')
        assert.deepEqual(roundTrip.templates.map(value => [value.id, value.version, value.contentHash]), source.templates.map(value => [value.id, value.version, value.contentHash]))

        // 6. 模板面板：单击加到播放头（第一次复制登记为工程模板），播放头移到定版帧看画面。
        await dock('模板')
        const [paramTemplate, nameTemplate] = source.templates
        const paramCard = page.locator(`[data-video-edit-template="library:${paramTemplate.id}"]`); await paramCard.waitFor({ state: 'visible', timeout: 30000 })
        evidence.steps.templatesPanel = { capture: await capture('styles-06-templates-panel') }
        await paramCard.click()
        let project = await savedProject(value => value.templates?.length === 1 && value.sequences[0].clips.length === 1)
        evidence.steps.apply = { template: project.templates[0], clip: project.sequences[0].clips[0] }
        assert.equal(project.templates[0].origin.id, paramTemplate.id)
        const seek = async frame => { const baseline = await read(documentRef, ['video_edit.document.program_playback']); await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '定位', changes: [{ kind: 'set_properties', entityType: 'video_edit.document', target: documentRef, properties: { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } } }] })); await presented(page, frame) }
        await seek(60); evidence.steps.apply.capture = await capture('styles-07-param-node')
        // 7. 拖入时间线：人名条落到拖放位置。
        const nameCard = page.locator(`[data-video-edit-template="library:${nameTemplate.id}"]`)
        const timeline = page.locator('[data-video-edit-panel="timeline"]')
        const box = await timeline.boundingBox()
        await nameCard.dragTo(timeline, { targetPosition: { x: Math.round(box.width * 0.55), y: Math.round(box.height * 0.45) } })
        project = await savedProject(value => value.templates?.length === 2 && value.sequences[0].clips.length === 2)
        const nameClip = project.sequences[0].clips.find(clip => clip.code.definitionId === project.templates[1].body.definitionId)
        evidence.steps.drag = { start: nameClip.start, track: nameClip.track }
        await seek(nameClip.start + 45); evidence.steps.drag.capture = await capture('styles-08-name-bar')
        // 8. 换内容不需要 AI：改实例参数；联动实例数与分离。
        const nameRef = { kind: 'video_edit.clip', id: `${PROJECT_ID}:${nameClip.id}` }
        const baseline = await read(nameRef, ['video_edit.clip.code_parameters'])
        await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '改名字', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: nameRef, properties: { 'video_edit.clip.code_parameters': { ...baseline.data.properties['video_edit.clip.code_parameters'], name: '王二', role: '摄影指导', label: 'DIRECTOR OF PHOTOGRAPHY' } } }] }))
        await seek(nameClip.start + 46); evidence.steps.parameters = { capture: await capture('styles-09-name-bar-edited') }
        const detached = await tool('detach_video_edit_template_instance', { documentRef, sequenceRef, clipRefs: [nameRef] })
        assert.equal(detached.verificationState, 'verified', JSON.stringify(detached))
        project = await savedProject(value => value.sequences[0].clips.find(clip => clip.id === nameClip.id)?.code.definitionId !== nameClip.code.definitionId)
        evidence.steps.detach = { parameters: project.sequences[0].clips.find(clip => clip.id === nameClip.id).code.parameters }
        assert.equal(evidence.steps.detach.parameters.name, '王二')
        evidence.completed = true; store()
      } catch (error) { evidence.failed = { message: String(error.message ?? error), stack: error.stack }; store(); await capture('styles-failed').catch(() => {}); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        store()
      }
    },
  }
}
module.exports = { createVideoEditStylesScene }
