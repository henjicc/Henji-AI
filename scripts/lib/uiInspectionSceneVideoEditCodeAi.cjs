const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

// 契约来源：author-api.md、author-text-motion.md、author-shaders.md、examples.md。
// 使用默认风格字体和比例；参数 size 可在外部 Agent 的批注处理事务内修改。
const CODE_AI_SOURCE = `export default {
  apiVersion:1, languageVersion:3, name:"Reality 极光标题", kind:"generator", mode:"dynamic",
  width:1920, height:1080, durationSeconds:4, seed:42,
  parameters:{size:{type:"number",title:"标题字号",default:96,min:48,max:160,step:1}},
  render(ctx){
    const enter=expoOut(progress(ctx.time,0,.6));
    return [
      shader({id:"sky",x:0,y:0,width:ctx.width,height:ctx.height,layers:[{type:"SolidColor",props:{color:[.02,.03,.06,1]}},{type:"Aurora",props:{speed:2}}]}),
      group({id:"heading",x:960,y:540+(1-enter)*80,opacity:enter},[
        rect({id:"plate",x:-600,y:-100,width:1200,height:200,radius:20,fill:ctx.style.palette.accent}),
        text({id:"title",x:0,y:0,text:"title",fontFamily:ctx.style.fonts.display.family,
          fontSize:ctx.params.size,fontWeight:600,align:"center",baseline:"middle",maxWidth:1100,maxLines:1,wrap:false,
          color:ctx.style.palette.fg,perChar:(i,n)=>({y:tween(ctx.time,stagger(i,.045),.6,48,0,"expoOut"),opacity:progress(ctx.time,stagger(i,.045),.28)})})
      ])
    ];
  }
}`

// 无片段变换、方形像素、等比例完整画幅。scene 的代码实例明确使用 x/y=0、scale=1。
function authorPointToMonitor(box, point, author = { width: 1920, height: 1080 }) {
  assert.ok(box && box.width > 0 && box.height > 0, '节目画面的 DOM 尺寸无效，无法映射作者坐标')
  assert.ok(point.x >= 0 && point.x <= author.width && point.y >= 0 && point.y <= author.height, '作者坐标超出画布')
  return { x: box.x + point.x / author.width * box.width, y: box.y + point.y / author.height * box.height }
}

function performanceSummary(steps, samples, longTasks) {
  const durations = samples.map(sample => sample.renderMs).filter(Number.isFinite)
  return { steps: steps.map(step => ({ id: step.id, renderMs: step.presentation?.renderMs ?? null })),
    presentations: samples.length, maxRenderMs: durations.length ? durations.reduce((max, value) => Math.max(max, value), 0) : null,
    maxLongTaskMs: longTasks.reduce((max, task) => Math.max(max, task.duration), 0), longTasks, samples }
}

function createVideoEditCodeAiScene() {
  return { id: 'video-edit-code-ai', surface: '剪辑', name: '剪辑-代码画面与AI协作真实回环', writesUserData: true,
    // 第 4 步故意让 Agent 把标注写成“已通过”，能力层必须拒绝；这条拒绝记录是预期的，其余错误照常判失败。
    expectedLogEvents: ['application.capability.execute.failed'],
    setup: async (page, app, { capture }) => {
      const { dialogs, saved, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
      const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
      const { openVideoEditFile, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
      const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, expectToolRefusal, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
      const root = path.resolve('node_modules/.cache/video-edit-code-ai')
      fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'code-ai.henji-video')
      const evidence = { completed: false, steps: [], paidPermission: false, modelSendInvoked: false, source: CODE_AI_SOURCE }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const button = name => page.getByRole('button', { name, exact: true })
      const canvas = page.locator('canvas[aria-label="剪辑画面"]')
      const snapshot = () => canvas.evaluate(node => ({ requestedAt: Number(node.dataset.requestedAt),
        renderMs: Number(node.dataset.renderMs), presentedFrame: Number(node.dataset.presentedFrame),
        presentedRevision: Number(node.dataset.presentedRevision), scrubbing: node.dataset.scrubbing,
        width: node.width, height: node.height }))
      let client; let previousLayout; let codeClip; let mark; let textClip; let documentRef; let sequenceRef
      let currentStep; let ownedProject = false; let authorized = false
      const step = async (id, title, action) => {
        currentStep = { id, title, completed: false }; evidence.steps.push(currentStep); store()
        try {
          await action(currentStep)
          currentStep.presentation = await snapshot()
          assert.ok(Number.isFinite(currentStep.presentation.renderMs), '节目画面没有有效 renderMs')
          currentStep.capture = await capture(`code-ai-${id}`)
          currentStep.completed = true; store()
        } catch (error) {
          currentStep.failure = `${title}失败：${error.message ?? error}`
          currentStep.presentation = await snapshot().catch(() => null)
          currentStep.capture = await capture(`code-ai-${id}-failed`).catch(reason => ({ error: String(reason) }))
          store(); throw new Error(currentStep.failure, { cause: error })
        }
      }
      const read = async (ref, propertyIds) => {
        const result = await callTool(client, 'read_application_entity', { ref, ...(propertyIds ? { propertyIds } : {}) })
        assert.ok(result.data?.properties, `实体未返回可读属性：${JSON.stringify(result)}`)
        return result
      }
      const ref = (kind, id) => ({ kind, id: id ? `${documentRef.id}:${id}` : documentRef.id })
      const change = async changes => {
        const owners = [...new Map(changes.map(item => item.target ?? item.parent).map(owner => [`${owner.kind}:${owner.id}`, owner])).values()]
        const baselines = []
        for (const owner of owners) baselines.push(await read(owner))
        const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '代码画面协作 Reality 验收', changes }))
        assert.equal(result.executionState, 'completed', `实体修改没有完成：${JSON.stringify(result)}`)
        assert.equal(result.verificationState, 'verified', `实体修改未读回验证：${JSON.stringify(result)}`)
        return result
      }
      const setChange = (target, properties) => ({ kind: 'set_properties', entityType: target.kind, target, properties })
      const set = (target, properties) => change([setChange(target, properties)])
      const create = (entityType, parent, properties) => change([{ kind: 'create_items', entityType, parent, items: [{ properties }] }])
      const focus = async target => {
        const result = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: target }))
        assert.equal(result.executionState, 'completed', `无法定位实体：${JSON.stringify(result)}`)
      }
      const waitRead = async (target, property, matches, reason) => {
        const deadline = Date.now() + 15000; let value
        do { value = (await read(target, [property])).data.properties[property]; if (matches(value)) return value; await page.waitForTimeout(100) } while (Date.now() < deadline)
        assert.fail(`${reason}：${JSON.stringify(value)}`)
      }
      const fresh = async (before, frame) => {
        await page.waitForFunction(({ before, frame }) => {
          const node = document.querySelector('canvas[aria-label="剪辑画面"]')
          const ruler = document.querySelector('[aria-label="剪辑时间定位"]')
          return Number(node?.dataset.requestedAt) > before && Number(node?.dataset.presentedFrame) === frame
            && Number(ruler?.getAttribute('aria-valuenow')) === frame && node.dataset.scrubbing === 'false'
        }, { before, frame }, { timeout: 30000 })
        return snapshot()
      }
      const seek = async frame => {
        const before = (await snapshot()).requestedAt
        await set(documentRef, { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } })
        await fresh(before, frame)
      }
      const dock = async title => {
        const tab = page.locator('.dv-tab').filter({ has: page.getByText(title, { exact: true }) }).first()
        if (await tab.isVisible()) await tab.click()
        else {
          await button('面板').click()
          await button(title).click()
        }
      }
      try {
        previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => {
          localStorage.removeItem('henji.videoEdit.dockLayout.v1')
          window.__codeAiEvidence = { samples: [], longTasks: [], longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask') }
          if (window.__codeAiEvidence.longTaskSupported) {
            window.__codeAiLongTasks = new PerformanceObserver(list => {
              for (const item of list.getEntries()) window.__codeAiEvidence.longTasks.push({ at: item.startTime, duration: item.duration })
            })
            window.__codeAiLongTasks.observe({ type: 'longtask', buffered: false })
          }
        })
        await step('01-project', '打开本地测试工程', async item => {
          // 与 mask 一样写缓存夹具、经正式 documents 创建项目、点项目卡打开。
          // 独立 1080p 图片夹具不依赖其他 Reality 场景或 FFmpeg，也不改写原素材。
          const image = path.resolve('resources/icons/icon.png')
          const metadata = await require('sharp')(image).metadata()
          const base = { id: 'base', mediaId: 'source', name: '本地图片', kind: 'image', track: 1, start: 0, duration: 300,
            sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
          const project = videoEditFixtureProject({ id: 'reality-code-ai', name: '代码画面与AI协作验收', revision: 0,
            width: 1920, height: 1080, fps: 30, media: [{ id: 'source', name: '本地图片', path: image, kind: 'image',
              width: metadata.width, height: metadata.height, durationSeconds: 10 }], clips: [base], annotations: [] })
          fs.writeFileSync(file, JSON.stringify(project))
          await button('剪辑').click()
          if (await button('关闭项目').isVisible()) await leaveVideoEditProject(page)
          await dialogs(app, [file], file)
          const opened = await openVideoEditFile(page, file); ownedProject = true
          documentRef = { kind: 'video_edit.document', id: opened.documentId }
          sequenceRef = ref('video_edit.sequence', project.sequences[0].id)
          await presented(page, 0)
          item.fixture = { file, image, resolution: [1920, 1080], documentRef, sequenceRef }
          await canvas.evaluate(node => {
            window.__codeAiFrames = new MutationObserver(() => window.__codeAiEvidence.samples.push({ at: performance.now(),
              frame: Number(node.dataset.presentedFrame), requestedAt: Number(node.dataset.requestedAt), renderMs: Number(node.dataset.renderMs) }))
            window.__codeAiFrames.observe(node, { attributes: true, attributeFilter: ['data-requested-at'] })
          })
          const identity = await authorizeMcpConnection(page, { name: '代码画面协作外部 Agent 验收', allowWrites: true, allowPaid: false })
          authorized = true; item.allowPaid = identity.allowPaid
          client = await connectMcpClient(identity.config, 'Henji code AI Reality external Agent')
        })
        await step('02-code-v3', '创建并呈现 v3 极光标题', async item => {
          await create('video_edit.code_material', documentRef, { 'video_edit.code_material.source': CODE_AI_SOURCE })
          const project = await saved(page, file, value => value.items.some(entry => entry.kind === 'code'))
          const codeItem = project.items.find(entry => entry.kind === 'code')
          await create('video_edit.clip', sequenceRef, { 'video_edit.clip.item_id': codeItem.id, 'video_edit.clip.kind': 'code',
            'video_edit.clip.name': 'Reality 极光标题', 'video_edit.clip.track': 2, 'video_edit.clip.start': 0,
            'video_edit.clip.duration': 120, 'video_edit.clip.x': 0, 'video_edit.clip.y': 0, 'video_edit.clip.scale': 1 })
          const inserted = await saved(page, file, value => value.sequences[0].clips.some(clip => clip.kind === 'code'))
          codeClip = inserted.sequences[0].clips.find(clip => clip.kind === 'code')
          // 最后一个字入场结束 .18+.6=.78；第 25 帧 (.833s) 是全部入场后的一帧。
          await seek(25)
          item.clipRef = ref('video_edit.clip', codeClip.id); item.requestedFrame = 25; item.languageVersion = 3
          assert.equal((await snapshot()).presentedFrame, 25, '节目画面未呈现请求的入场后帧')
        })
        await step('03-pick-element', '点选标题并定位源码高亮', async item => {
          await focus(ref('video_edit.clip', codeClip.id))
          const point = authorPointToMonitor(await canvas.boundingBox(), { x: 960, y: 540 })
          await page.mouse.click(point.x, point.y)
          await page.locator('[aria-label="代码元素选择层"] [data-code-element-selected="true"]').waitFor({ state: 'visible' })
          item.point = point
          item.selectedElement = await page.locator('[aria-label="代码元素选择层"] [data-code-element-label]').innerText()
          assert.match(item.selectedElement, /title/, '点选结果不是带 id 的标题元素')
          const open = button('查看与编辑源码')
          if (await open.isVisible()) await open.click()
          const editor = page.getByRole('textbox', { name: '代码素材源码', exact: true })
          await editor.waitFor({ state: 'visible' })
          item.sourceSelection = await editor.evaluate(node => ({ start: node.selectionStart, end: node.selectionEnd,
            text: node.value.slice(node.selectionStart, node.selectionEnd) }))
          assert.ok(item.sourceSelection.end > item.sourceSelection.start && /id:\s*"title"/.test(item.sourceSelection.text), '源码编辑器未高亮所选 title 的源码范围')
        })
        await step('04-annotations', '批注草稿、外部处理和用户审查', async item => {
          if (await button('收起源码编辑').isVisible()) await button('收起源码编辑').click()
          // C 在 program 是评论钉，在 timeline 是剃刀；聚焦真实节目宿主保证作用域。
          await page.locator('[data-video-edit-panel="program"]').evaluate(node => { node.tabIndex = -1; node.focus() })
          await page.keyboard.press('c')
          const mode = page.getByRole('toolbar', { name: '节目监视器控制', exact: true }).locator('label', { hasText: '标注' }).locator('..').getByRole('button')
          await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="节目监视器控制"] label')]
            .find(label => label.textContent === '标注')?.parentElement?.querySelector('button')?.textContent.includes('点标注'), null, { timeout: 5000 })
          item.shortcut = { key: 'C', scope: 'program', mode: await mode.innerText() }
          const point = authorPointToMonitor(await canvas.boundingBox(), { x: 960, y: 540 })
          await page.mouse.click(point.x, point.y)
          const input = page.getByRole('textbox', { name: '这里要改什么？', exact: true })
          await input.fill('标题再大一点'); await input.press('Enter')
          await dock('批注')
          const panel = page.getByLabel('批注面板', { exact: true })
          await panel.getByText('1 条待发送', { exact: true }).waitFor({ state: 'visible' })
          const project = await saved(page, file, value => value.sequences[0].annotations.length === 1)
          mark = project.sequences[0].annotations[0]; item.markId = mark.id; item.draft = mark
          assert.equal(mark.status, 'draft', '新建批注不是待发送草稿')
          await panel.getByRole('button', { name: '复制给外部 Agent', exact: true }).click()
          const markRef = ref('video_edit.annotation', mark.id)
          item.published = await waitRead(markRef, 'video_edit.annotation.status', value => value === 'open', '复制给外部 Agent 后草稿没有转为待处理')
          const reply = { id: randomUUID(), author: { kind: 'external', name: 'Reality 外部 Agent' }, createdAt: new Date().toISOString(),
            text: '把标题字号从96调为112；可用“撤销这次修改”恢复。' }
          const beforeAgentEdit = (await snapshot()).requestedAt
          await change([setChange(ref('video_edit.clip', codeClip.id), { 'video_edit.clip.code_parameters': { ...codeClip.code.parameters, size: 112 } }),
            setChange(markRef, { 'video_edit.annotation.thread': [reply], 'video_edit.annotation.status': 'addressed' })])
          item.agentPresentation = await fresh(beforeAgentEdit, 25)
          item.agentParameters = (await read(ref('video_edit.clip', codeClip.id), ['video_edit.clip.code_parameters'])).data.properties['video_edit.clip.code_parameters']
          assert.equal(item.agentParameters.size, 112, '外部 Agent 的字号修改没有读回')
          const row = panel.locator(`[data-video-edit-annotation="${mark.id}"]`)
          await row.getByText('待审查', { exact: true }).waitFor({ state: 'visible' })
          item.addressed = (await read(markRef, ['video_edit.annotation.status', 'video_edit.annotation.thread'])).data.properties
          assert.equal(item.addressed['video_edit.annotation.status'], 'addressed', '外部 Agent 处理后状态不是待审查')
          assert.ok(item.addressed['video_edit.annotation.thread'].some(message => message.id === reply.id), '外部 Agent 处理回复未保存')
          item.reviewCapture = await capture('code-ai-04-addressed')
          await row.getByRole('button', { name: '通过', exact: true }).click()
          item.resolved = await waitRead(markRef, 'video_edit.annotation.status', value => value === 'resolved', '用户通过后状态没有变为已通过')
          await row.getByText('已通过', { exact: true }).waitFor({ state: 'visible' })
          // 先重开再尝试，防止“resolved -> resolved”无操作捷径掩盖权限漏洞。
          await row.getByRole('button', { name: '重开', exact: true }).click()
          await waitRead(markRef, 'video_edit.annotation.status', value => value === 'open', '用户重开后状态未恢复待处理')
          item.agentResolveRefusal = await expectToolRefusal(client, 'change_application_entities', operationEnvelope([await read(markRef)],
            { summary: '验证 Agent 不能代替用户通过', changes: [setChange(markRef, { 'video_edit.annotation.status': 'resolved' })] }))
          assert.match(item.agentResolveRefusal, /只有用户能审查通过标注/, '拒绝原因没有指向用户审查权限，可能是其他调用错误')
          assert.equal((await read(markRef, ['video_edit.annotation.status'])).data.properties['video_edit.annotation.status'], 'open', '越权调用改变了批注状态')
        })
        await step('05-observe', '观察批注叠加与局部裁切媒体', async item => {
          // Observation is read-only: no operation envelope (operationId/baselineIds belong to writes).
          const result = await callTool(client, 'observe_video_edit_frame', {
            documentRef, target: { kind: 'program', sequenceRef, frame: 25 }, maxWidth: 960,
            overlayAnnotations: true, annotationIds: [mark.id], cropAnnotationId: mark.id })
          item.result = result
          const data = result.result?.data ?? result.data
          assert.equal(data?.verification?.verified, true, `批注取帧没有验证成功：${JSON.stringify(result).slice(0, 400)}`)
          assert.equal(data?.resultRef?.kind, 'asset', '批注取帧没有返回媒体资产引用')
          result.data = data
          const media = await callTool(client, 'read_application_media', { ref: result.data.resultRef, offset: 0, length: 256 })
          item.media = { ...media.data, base64: undefined }
          assert.match(media.data.mimeType, /^image\//, '返回媒体不是图片')
          assert.ok(media.data.byteLength > 0 && media.data.base64, '返回图片媒体为空')
        })
        await step('06-fonts', '字体悬停预览、Esc 恢复和一步撤销', async item => {
          // 同一工程，代码结束后创建原生文字，确保文字预览没有被 shader 背景遮住。
          await create('video_edit.item', documentRef, { 'video_edit.item.kind': 'text', 'video_edit.item.name': '字体验收素材' })
          const withItem = await saved(page, file, value => value.items.some(entry => entry.name === '字体验收素材'))
          const textItem = withItem.items.find(entry => entry.name === '字体验收素材')
          await create('video_edit.clip', sequenceRef, { 'video_edit.clip.item_id': textItem.id, 'video_edit.clip.kind': 'text', 'video_edit.clip.name': '字体验收文字',
            'video_edit.clip.text': '痕迹 字体预览', 'video_edit.clip.track': 3, 'video_edit.clip.start': 140, 'video_edit.clip.duration': 100 })
          const project = await saved(page, file, value => value.sequences[0].clips.some(clip => clip.name === '字体验收文字'))
          textClip = project.sequences[0].clips.find(clip => clip.name === '字体验收文字')
          const textRef = ref('video_edit.clip', textClip.id)
          await seek(150); await focus(textRef); await dock('效果控件')
          const property = 'video_edit.clip.text_style'
          item.before = (await read(textRef, [property])).data.properties[property]
          const picker = button('文字字体'); await picker.waitFor({ state: 'visible' }); await picker.click()
          const search = page.getByRole('textbox', { name: '搜索字体', exact: true })
          await search.fill('黑')
          const options = page.getByRole('listbox', { name: '字体列表', exact: true }).getByRole('option')
          // 本机“黑”若不足两种，查询全部中文家族，在其中挑一个实际存在的名字再次搜索。
          let fallback = false
          try { await options.nth(1).waitFor({ state: 'visible', timeout: 5000 }) } catch { fallback = true }
          if (fallback) {
            const families = new Map(); let cursor
            do {
              const result = await callTool(client, 'list_application_entities', { entityType: 'font',
                propertyIds: ['font.family', 'font.localized_name', 'font.supports_cjk'], limit: 100, ...(cursor ? { cursor } : {}) })
              for (const face of result.data.items) if (face.properties['font.supports_cjk']) families.set(face.properties['font.family'], face.properties['font.localized_name'])
              cursor = result.data.nextCursor
            } while (cursor)
            assert.ok(families.size >= 2, '本机不足两种中文字体家族，无法验证中文字体第二项预览')
            const name = [...families.values()][0]; await search.fill(name); item.searchProbe = name
            await search.fill(''); await button('字体分类').click(); await page.getByRole('option', { name: '中文', exact: true }).click()
          }
          item.query = fallback ? '本机中文字体（MCP查询后切中文分类）' : '黑'
          await options.nth(1).waitFor({ state: 'visible' })
          const beforePreview = (await snapshot()).requestedAt
          item.previewOption = await options.nth(1).innerText(); await options.nth(1).hover()
          item.preview = await fresh(beforePreview, 150)
          // 悬停是临时领域手势；读回 fontFamily 必须临时变化。
          item.previewStyle = await waitRead(textRef, property, value => value?.fontFamily !== item.before?.fontFamily, '悬停第二项没有预览字体')
          const beforeEscape = (await snapshot()).requestedAt
          await page.keyboard.press('Escape'); await fresh(beforeEscape, 150)
          item.restored = await waitRead(textRef, property, value => JSON.stringify(value) === JSON.stringify(item.before), 'Esc 没有恢复原文字样式')
          await picker.click()
          await options.nth(1).waitFor({ state: 'visible' })
          const beforeSelection = (await snapshot()).requestedAt
          item.chosenOption = await options.nth(1).innerText(); await options.nth(1).click()
          item.selected = await waitRead(textRef, property, value => value?.fontFamily !== item.before?.fontFamily, '选中字体后 fontFamily 没有改变')
          await page.getByRole('textbox', { name: '搜索字体', exact: true }).waitFor({ state: 'hidden' })
          item.selectedPresentation = await fresh(beforeSelection, 150)
          item.selectedCapture = await capture('code-ai-06-font-selected')
          // 点工具栏撤销，不让输入框的局部文字历史吞掉快捷键。
          const beforeUndo = (await snapshot()).requestedAt; await button('撤销').click()
          item.undone = await waitRead(textRef, property, value => JSON.stringify(value) === JSON.stringify(item.before), '一步撤销未恢复选择字体之前的文字样式')
          item.undoPresentation = await fresh(beforeUndo, 150)
        })
        await step('07-style-kit', '切换内置风格并重渲染代码底板', async item => {
          await seek(25); await focus(ref('video_edit.clip', codeClip.id))
          const panel = page.locator('[data-video-edit-style-kits]')
          // 聚焦片段会异步把效果控件推到前台；切到风格后确认风格面板真的可见再操作。
          for (let attempt = 0; attempt < 3 && !(await panel.isVisible()); attempt++) { await dock('风格'); await panel.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}) }
          item.dockState = await page.evaluate(() => ({
            tabs: [...document.querySelectorAll('.dv-tab')].map(tab => ({ text: tab.textContent?.trim(), active: tab.classList.contains('dv-active-tab') })),
            panels: [...document.querySelectorAll('[data-video-edit-panel]')].map(el => ({ id: el.getAttribute('data-video-edit-panel'), visible: !!(el.offsetWidth || el.offsetHeight), w: el.offsetWidth, h: el.offsetHeight })),
            styleKits: [...document.querySelectorAll('[data-video-edit-style-kits]')].map(el => ({ w: el.offsetWidth, h: el.offsetHeight, text: el.textContent?.slice(0, 120) })),
          }))
          await panel.waitFor({ state: 'visible' })
          const before = await snapshot(); item.before = before
          await panel.getByRole('button', { name: '选择风格', exact: true }).click()
          await page.getByRole('option', { name: '科技信息', exact: true }).click()
          await panel.getByRole('button', { name: '应用到序列', exact: true }).click()
          const project = await saved(page, file, value => value.styleKits?.some(kit => kit.name === '科技信息') && value.sequences[0].styleKitId)
          const applied = project.styleKits.find(kit => kit.id === project.sequences[0].styleKitId)
          assert.equal(applied?.name, '科技信息', '科技信息预设没有绑定当前序列')
          item.applied = { id: applied.id, name: applied.name, accent: applied.tokens.palette.accent }
          item.after = await fresh(before.requestedAt, 25)
          item.sourceUsesStyleAccent = CODE_AI_SOURCE.includes('fill:ctx.style.palette.accent')
          assert.ok(item.sourceUsesStyleAccent, '底板未读取 ctx.style.palette.accent，不能验证风格失效重渲染')
        })
        await step('08-shader-effect', '效果库添加镜头色差并重渲染', async item => {
          await seek(130); await focus(ref('video_edit.clip', 'base')); await dock('效果')
          const before = await snapshot(); item.before = before
          // “色差”是旧 CPU 效果；“镜头色差”才是 shaders 框架的 ChromaticAberration。
          const entry = page.locator('[data-video-edit-effects-entry]').filter({ hasText: '镜头色差' }).first()
          await entry.waitFor({ state: 'visible' }); await entry.dblclick()
          const project = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'base').effects?.length === 1)
          const effect = project.sequences[0].clips.find(clip => clip.id === 'base').effects[0]
          item.effect = effect
          assert.equal(effect.builtin?.id, 'shaders.ChromaticAberration', '添加的不是着色器镜头色差滤镜')
          const controls = page.locator(`[data-video-edit-effect="${effect.id}"]`)
          await controls.waitFor({ state: 'visible' })
          await controls.getByLabel('强度', { exact: true }).waitFor({ state: 'visible' })
          await controls.getByLabel('角度', { exact: true }).waitFor({ state: 'visible' })
          item.after = await fresh(before.requestedAt, 130)
        })
        await step('09-performance', '汇总呈现耗时与主线程长任务', async item => {
          const observations = await page.evaluate(() => {
            const state = window.__codeAiEvidence
            for (const entry of window.__codeAiLongTasks?.takeRecords() ?? []) state.longTasks.push({ at: entry.startTime, duration: entry.duration })
            return state
          })
          assert.ok(observations.longTaskSupported, '当前 Electron 不支持 longtask 观察，无法提供最大长任务证据')
          evidence.performance = performanceSummary(evidence.steps, observations.samples, observations.longTasks)
          item.maxLongTaskMs = evidence.performance.maxLongTaskMs
          assert.ok(observations.samples.length > 0, '没有观察到任何新的节目画面呈现')
        })
        evidence.completed = true
      } catch (error) {
        evidence.failure = { step: currentStep?.id, message: String(error.message ?? error), stack: error.stack }
        throw error
      } finally {
        const observations = await page.evaluate(() => {
          window.__codeAiFrames?.disconnect(); window.__codeAiLongTasks?.disconnect()
          return window.__codeAiEvidence
        }).catch(() => null)
        if (observations) evidence.performance = performanceSummary(evidence.steps, observations.samples, observations.longTasks)
        const cleanup = async (label, action) => { try { await action() } catch (error) { evidence.completed = false; (evidence.cleanupFailures ??= []).push(`${label}：${error.message ?? error}`) } }
        await cleanup('关闭外部 MCP 客户端', async () => { await client?.close() })
        if (authorized) await cleanup('撤销 MCP 授权', () => disableMcp(page))
        if (ownedProject) await cleanup('关闭测试工程', () => leaveVideoEditProject(page))
        if (previousLayout !== undefined) await cleanup('恢复停靠布局', () => page.evaluate(previous => {
          if (previous === null) localStorage.removeItem('henji.videoEdit.dockLayout.v1')
          else localStorage.setItem('henji.videoEdit.dockLayout.v1', previous)
          for (const key of ['__codeAiFrames', '__codeAiLongTasks', '__codeAiEvidence']) delete window[key]
        }, previousLayout))
        store()
      }
      if (evidence.cleanupFailures?.length) throw new Error(evidence.cleanupFailures.join('；'))
      return evidence
    },
  }
}

module.exports = { createVideoEditCodeAiScene, CODE_AI_SOURCE, authorPointToMonitor, performanceSummary }
