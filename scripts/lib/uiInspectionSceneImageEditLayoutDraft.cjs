/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检采用仓内 CommonJS 场景。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1]
function layoutFixture(canvas, benchmark) {
  const f = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
  const doc = f.createImageEditDocumentV3({ width: 840, height: 420, documentId: `reality-layout-${canvas ? 'canvas' : 'toolbox'}${benchmark ? '-100' : ''}` })
  const hero = f.createImageEditRasterLayerV3('hero', '主图'); hero.transform = [1, 0, 0, 1, 70, 110]
  const mirrored = f.createImageEditRasterLayerV3('mirror', '组内镜像'); mirrored.transform = [-1, 0, 0, 1, 310, 135]
  const group = f.createImageEditGroupLayerV3('group', '参考组'); group.transform = [1, .1, .15, 1, 10, -20]; group.children = [mirrored]
  const rotated = f.createImageEditRasterLayerV3('rotate', '旋转图'); rotated.transform = [.94, .342, -.342, .94, 420, 175]
  const locked = f.createImageEditRasterLayerV3('locked', '锁定图'); locked.transform = [1, 0, 0, 1, 700, 110]; locked.locked = true
  doc.layers = [hero, group, rotated, locked]
  if (benchmark) doc.layers = Array.from({ length: 100 }, (_, i) => ({ ...f.createImageEditRasterLayerV3(`bench-${i}`, `参考图 ${i + 1}`), transform: [.1, 0, 0, .1, 30 + (i % 10) * 72 + i % 3, 20 + Math.floor(i / 10) * 38 + i * 7 % 13] }))
  return doc
}

function createImageEditLayoutDraftScene(context, canvas = false, benchmark = false, panelReview = false, explanation = false) {
  return {
    id: explanation ? `image-edit-explanation${canvas ? '-node' : ''}` : `${canvas ? 'image-edit-layout-draft-node' : 'image-edit-layout-draft'}${panelReview ? '-panel' : benchmark ? '-100' : ''}`, surface: canvas ? '画布' : '图片编辑',
    name: `${canvas ? '画布图片文档节点' : '工具箱'}-${explanation ? '录制讲解审阅布局应用撤销' : benchmark ? '100层随手摆性能' : '随手摆候选钉住应用撤销重开'}`, writesUserData: true,
    launchArgs: canvas ? [] : ['--dev-surface=tool.image_edit'],
    expectedLogEvents: ['image_edit.layout.optimize.failed'],
    setup: async (page, app, { capture }) => {
      page.setDefaultTimeout(15000)
      const reviewWidth = panelReview ? await page.evaluate(() => innerWidth) : undefined
      const root = path.resolve(`.tmp/ui-inspection/${explanation ? 't157-explanation' : 't149-layout'}-${canvas ? 'canvas' : 'toolbox'}${panelReview ? `-panel-${reviewWidth}` : benchmark ? '-100' : ''}`)
      fs.mkdirSync(root, { recursive: true })
      const evidence = { frames: [], candidateMs: [], abMs: [], fidelityMs: [], visualReview: '待逐张目视', benchmark: panelReview ? '仅面板验收，不测性能' : '5次预热，30次测量；输入到合成回执与下一帧；非物理屏幕延迟' }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const restore = await blockPaidGeneration(app)
      const restoreExplanation = explanation ? await require('./uiInspectionSceneImageEditExplanation.cjs').installImageExplanationFixture(page, app) : async () => {}
      const host = () => page.locator('[data-image-editor-v3]:visible').last()
      const controls = () => page.locator('[data-image-layout-controls]')
      const button = name => controls().getByRole('button', { name, exact: true })
      const choice = name => controls().getByRole('radio', { name, exact: true })
      const waitApply = () => page.waitForFunction(() => [...document.querySelectorAll('[data-image-layout-controls] button')].some(b => b.textContent === '应用' && !b.disabled), undefined, { timeout: 60000 })
      const panel = async () => { if (!await controls().isVisible()) await host().getByRole('button', { name: '随手摆', exact: true }).click(); await controls().waitFor() }
      const closePanel = async () => { if (await controls().isVisible()) { await host().getByRole('button', { name: '随手摆', exact: true }).click(); await controls().waitFor({ state: 'hidden' }) } }
      const select = async ids => {
        await closePanel()
        for (let i = 0; i < ids.length; i++) await host().locator(`[data-layer-id="${ids[i]}"] [data-layer-select]`).click({ modifiers: i ? ['Control'] : [] })
      }
      let projectId, documentRef, target
      const read = () => page.evaluate(documentRef => window.henjiNative.imageEditorV3.loadDocument({ requestId: crypto.randomUUID(), documentRef }), documentRef)
      const shot = async name => {
        await context.settlePage(page, 300)
        await host().locator('[data-preview-target-mip-coverage="1.0000"]').waitFor({ timeout: 60000 })
        assert.equal(await host().locator('[data-command-bar]').count(), 1)
        assert.ok(await host().locator('[data-context-bar]').count() <= 1)
        const suffix = `step-${String(evidence.frames.length + 1).padStart(2, '0')}`
        await capture(suffix)
        evidence.frames.push({ name, suffix, presentation: await host().locator('[data-presentation-front-surface]').evaluate(c => ({ ...c.dataset })) }); store()
      }
      const opened = async () => {
        await host().waitFor({ timeout: 60000 })
        await host().locator('[data-preview-target-mip-coverage="1.0000"]').waitFor({ timeout: 60000 })
        const group = host().locator('[data-layer-id="group"]')
        if (await group.count() && await group.getByRole('button', { name: '展开图层组', exact: true }).count()) await group.getByRole('button', { name: '展开图层组', exact: true }).click()
      }
      try {
        const doc = layoutFixture(canvas, benchmark)
        if (explanation) doc.id += '-explanation'
        if (panelReview) doc.id += `-panel-${reviewWidth}`
        evidence.layers = benchmark ? 100 : 4
        if (canvas) ({ projectId } = await context.seedAndOpenCanvasPanoramaProject(page))
        const seeded = await page.evaluate(async ({ doc, projectId, canvas }) => {
          const api = window.henjiNative.imageEditorV3, refs = [], urls = []
          const layers = doc.layers.flatMap(l => l.type === 'group' ? l.children : [l])
          // 不同大小、带透明留白的真实 Alpha 边缘，避免中心等距冒充可见边缘等距。
          for (let i = 0; i < layers.length; i++) {
            const c = document.createElement('canvas'); c.width = 160; c.height = 180
            const drawing = c.getContext('2d'); assertDrawing(drawing)
            drawing.fillStyle = ['rgb(220,105,55)', 'rgb(45,150,180)', 'rgb(145,90,185)', 'rgb(90,150,75)'][i % 4]
            drawing.fillRect(16 + i % 4 * 4, 18, 124 - i % 4 * 15, 140 - i % 4 * 12)
            drawing.fillStyle = 'rgb(245,245,245)'; drawing.font = 'bold 20px sans-serif'; drawing.fillText(['主图', '镜像', '旋转', '锁定'][i % 4], 32, 70)
            const source = await api.ingestSource({ requestId: crypto.randomUUID(), source: { kind: 'data-url', dataUrl: c.toDataURL() } })
            layers[i].source = { kind: 'resource', resourceId: source.resource.resourceRef }; refs.push(source.resource.resourceRef); urls.push(source.mediaUrl)
          }
          const saved = await api.saveDocument({ requestId: crypto.randomUUID(), document: doc, expectedRevision: 0, history: null, resourceRefs: refs, previewRef: null })
          if (!canvas) {
            const ready = await api.createImageDocument({ requestId: crypto.randomUUID(), documentId: doc.id, container: { kind: 'user' }, emptyUntilRevision: null })
            return { documentRef: ready.working.documentRef, target: { id: ready.read.meta.id, path: ready.read.meta.path } }
          }
          const project = await window.henjiNative.testFixtures.readCanvas(projectId)
          project.nodes.push({ id: '__t149_layout_node', type: 'layerStackResultNode', position: { x: 520, y: 80 }, data: {
            displayName: '随手摆验收', resultKind: 'layer-stack', isGenerating: false, aspectRatio: '2:1', imageUrl: urls[0], previewImageUrl: urls[0],
            imageEditSession: { kind: 'image-edit-v3', sourceUrl: urls[0], documentRef: saved.documentRef, revision: saved.revision, previewRef: null } } })
          await window.henjiNative.testFixtures.writeCanvas(projectId, { ...project, viewport: { x: 80, y: 100, zoom: .65 } })
          return { documentRef: saved.documentRef }
          function assertDrawing(value) { if (!value) throw new Error('无法创建布局夹具') }
        }, { doc, projectId, canvas })
        documentRef = seeded.documentRef; target = seeded.target
        const open = async () => {
          if (canvas) {
            await context.reopenCanvasProjectFromStorage(page, projectId)
            await page.locator('[data-layer-stack-node-id="__t149_layout_node"]').getByRole('button', { name: /^(编辑|Edit)$/i }).click()
          } else {
            await page.reload(); await context.settlePage(page, 500)
            await page.locator(`[data-project-id="${target.id}"]`).dblclick()
          }
          await opened()
        }
        await open()
        if (explanation) { await require('./uiInspectionSceneImageEditExplanation.cjs').runImageExplanationScene({ page, app, host, read, select, shot, evidence, store }); return }
        if (benchmark) {
          const first = host().locator('[data-layer-select]').first(); await first.click(); await first.press('End')
          await page.waitForTimeout(200)
          await host().locator('[data-layer-select]:focus').click({ modifiers: ['Shift'] })
          await shot('100层粗摆')
          await panel(); await button('整理').click(); await waitApply()
          await choice('等距排列').click(); await shot('100层等距候选')
          assert.equal((await read()).document.creativeIntents.drafts.at(-1).targets.length, 100, '必须真实选中100层，不能以单层冒充基准')
          evidence.spacing = await page.evaluate(async documentRef => {
            const api = window.henjiNative.imageEditorV3
            const loaded = await api.loadDocument({ requestId: crypto.randomUUID(), documentRef })
            const draft = loaded.document.creativeIntents.drafts.at(-1)
            const pages = await Promise.all(draft.recipeRefs.map(ref => api.readLayoutResource({ requestId: crypto.randomUUID(), resourceRef: ref.resourceId })))
            const entries = pages.flatMap(page => page.entries)
            const candidates = await Promise.all(draft.candidateRefs.map(ref => api.readLayoutResource({ requestId: crypto.randomUUID(), resourceRef: ref.resourceId })))
            const candidate = candidates.find(c => c.id === 'distribute')
            return entries.map(entry => {
              const change = candidate.changes.find(c => c.targetRef.id === entry.item.targetRef.id)
              const corners = entry.item.worldCorners.map(([x, y]) => [x + change.delta[0], y + change.delta[1]])
              return { id: entry.layerId, left: Math.min(...corners.map(p => p[0])), right: Math.max(...corners.map(p => p[0])), top: Math.min(...corners.map(p => p[1])), bottom: Math.max(...corners.map(p => p[1])) }
            })
          }, documentRef)
          const rows = new Map()
          for (const box of evidence.spacing) { const key = Math.round(box.top * 1e6); const row = rows.get(key) ?? []; row.push(box); rows.set(key, row) }
          assert.equal(rows.size, 10, '等距必须保持原十行，不能挤成一行')
          let bottom = -Infinity
          for (const row of [...rows.values()].sort((a, b) => a[0].top - b[0].top)) {
            row.sort((a, b) => a.left - b.left)
            assert.equal(row.length, 10, '每个原有行的十对象都须保留')
            assert.ok(row[0].top >= bottom - 1e-6, '行与行不能重叠')
            const gaps = row.slice(1).map((box, i) => box.left - row[i].right)
            gaps.forEach(gap => { assert.ok(gap > 0, '真实边缘必须留出间距'); assert.ok(Math.abs(gap - gaps[0]) < 1e-6, '每行真实边缘间距相等') })
            bottom = Math.max(...row.map(box => box.bottom))
          }
          store()
        } else {
        if (panelReview) {
          await select(['hero']); await panel(); await controls().getByText('至少选择三个独立图层', { exact: true }).waitFor(); await shot('不足三层状态')
        }
        await select(['hero', 'mirror', 'rotate', 'locked']); await shot('粗摆-组内镜像旋转锁层')
        await panel(); await button('整理').click(); await waitApply(); await shot('整理候选')
        evidence.candidates = await page.evaluate(async documentRef => {
          const api = window.henjiNative.imageEditorV3, loaded = await api.loadDocument({ requestId: crypto.randomUUID(), documentRef })
          const draft = loaded.document.creativeIntents.drafts.at(-1)
          return Promise.all(draft.candidateRefs.map(ref => api.readLayoutResource({ requestId: crypto.randomUUID(), resourceRef: ref.resourceId })))
        }, documentRef); store()
        await choice('等距排列').click(); await shot('切换等距候选')
        if (panelReview) {
          assert.equal(await controls().locator('[role=radio][aria-checked=true]').count(), 1)
          await choice('等距排列').press('Home'); await choice('原稿').press('ArrowDown')
          assert.equal(await choice('边缘对齐').evaluate(e => e === document.activeElement && e.getAttribute('aria-checked') === 'true'), true)
          const bounds = await controls().evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth, right: e.getBoundingClientRect().right, viewport: innerWidth }))
          assert.ok(bounds.scroll <= bounds.width && bounds.right <= bounds.viewport, '面板不能横向溢出')
          await shot('候选键盘焦点')
          await choice('等距排列').click()
          if (await page.evaluate(() => innerWidth) < 1000) return
        }
        assert.equal(await host().getByLabel('示范姿态残影与轨迹').evaluate(e => getComputedStyle(e).pointerEvents), 'none')
        await select(['hero']); await panel(); await button('钉住所选图层的原稿位置').click()
        await button('解钉 · 主图').waitFor({ timeout: 60000 }); await waitApply(); await shot('钉住主图')
        await page.getByRole('slider', { name: '保留原稿位置', exact: true }).press('ArrowRight'); await waitApply(); await shot('保真调整')
        // 保真归零后检查正式边缘的对齐与等距；保真值大于零有意保留粗摆偏差。
        await page.getByRole('slider', { name: '保留原稿位置', exact: true }).press('Home'); await waitApply()
        await choice('等距排列').click()
        const before = (await read()).document
        await button('应用').click(); await controls().getByText('已应用，可撤销', { exact: true }).waitFor({ timeout: 60000 }); await shot('应用反馈'); await closePanel()
        const after = (await read()).document
        const transforms = d => [d.layers[0], d.layers[1].children[0], d.layers[2], d.layers[3]].map(l => l.transform)
        const waitSaved = async expected => {
          const deadline = Date.now() + 30000
          while (JSON.stringify(transforms((await read()).document)) !== JSON.stringify(transforms(expected))) {
            assert.ok(Date.now() < deadline, '历史操作结果未保存')
            await page.waitForTimeout(100)
          }
        }
        assert.deepEqual(after.layers[0].transform, before.layers[0].transform, '硬钉主图不动')
        assert.deepEqual(after.layers[3].transform, before.layers[3].transform, '锁层不动')
        assert.deepEqual(after.layers[1].transform, before.layers[1].transform, '组结构与祖先变换不动')
        evidence.applied = { before: transforms(before), after: transforms(after) }; store()
        await host().getByRole('button', { name: '撤销', exact: true }).click(); await panel(); await controls().getByText('已撤销布局', { exact: true }).waitFor(); await shot('一次撤销'); await closePanel()
        await waitSaved(before)
        assert.deepEqual(transforms((await read()).document), transforms(before))
        await host().getByRole('button', { name: '重做', exact: true }).click(); await panel(); await controls().getByText('已重做布局', { exact: true }).waitFor(); await shot('重做'); await closePanel()
        await waitSaved(after)
        assert.deepEqual(transforms((await read()).document), transforms(after))
        if (canvas) await page.getByRole('dialog', { name: /多图层图片编辑器/ }).getByRole('button', { name: /关闭编辑器/ }).click()
        else {
          await host().getByRole('button', { name: /返回图片文档列表/ }).click()
          // 新建夹具是真实草稿；按正式离开保存流程起名，不刷新打断写回。
          await page.getByRole('alertdialog').getByRole('button', { name: '保存', exact: true }).click()
          const naming = page.getByRole('dialog', { name: '保存', exact: true })
          await naming.getByRole('textbox').fill('随手摆验收')
          await naming.getByRole('button', { name: '保存', exact: true }).click()
          await naming.waitFor({ state: 'hidden', timeout: 60000 })
          await page.locator(`[data-project-id="${target.id}"]`).waitFor({ timeout: 60000 })
        }
        await open(); await panel(); await button('解钉 · 主图').waitFor({ timeout: 60000 }); await choice('原稿').waitFor({ timeout: 60000 }); await shot('保存重开草稿')
        assert.deepEqual(transforms((await read()).document), transforms(after))
        assert.equal((await read()).document.creativeIntents.drafts.at(-1).pins.length, 1)
        }
        if (!panelReview) {
        await page.evaluate(() => {
          window.__layoutInputs = []; window.__layoutFrames = []; window.__layoutComputes = []
          new PerformanceObserver(list => { for (const m of list.getEntries()) if (m.name === 'image-layout-candidate-generation') window.__layoutComputes.push({ duration: m.duration, end: m.startTime + m.duration }) }).observe({ entryTypes: ['measure'] })
          const selector = '[data-image-editor-v3] [data-presentation-front-surface]'
          let generation = document.querySelector(selector).dataset.renderGeneration
          new MutationObserver(() => { const next = document.querySelector(selector).dataset.renderGeneration; if (next !== generation) { generation = next; const at = performance.now(); requestAnimationFrame(() => window.__layoutFrames.push({ at, presentedAt: performance.now(), generation })) } }).observe(document.querySelector(selector), { attributes: true, attributeFilter: ['data-render-generation'] })
          document.addEventListener('click', event => { if (event.target.closest?.('[data-image-layout-controls] button')) window.__layoutInputs.push(event.timeStamp) }, true)
          document.addEventListener('keyup', event => { if (event.target.getAttribute?.('aria-label') === '保留原稿位置') window.__layoutInputs.push(event.timeStamp) }, true)
        })
        const sample = async (action, compute = false) => {
          const baseline = await page.evaluate(compute => ({ compute, computes: window.__layoutComputes.length, count: window.__layoutInputs.length, generation: document.querySelector('[data-image-editor-v3] [data-presentation-front-surface]').dataset.renderGeneration }), compute)
          await action()
          await page.waitForFunction(({ count, generation, compute, computes }) => {
            const input = window.__layoutInputs[count]
            const controls = document.querySelector('[data-image-layout-controls]')
            const ready = [...controls.querySelectorAll('button')].find(b => b.textContent === '应用' || b.textContent === '整理')
            const completed = compute ? window.__layoutComputes[computes]?.end : input
            return input !== undefined && completed !== undefined && ready && !ready.disabled && !controls.textContent.includes('正在整理布局') && window.__layoutFrames.some(f => f.at >= completed && f.generation !== generation)
          }, baseline, { timeout: 60000 })
          return page.evaluate(({ count, generation, compute, computes }) => { const input = window.__layoutInputs[count]; const completed = compute ? window.__layoutComputes[computes].end : input; return window.__layoutFrames.find(f => f.at >= completed && f.generation !== generation).presentedAt - input }, baseline)
        }
        const ab = async i => sample(() => choice(i % 2 ? '等距排列' : '原稿').click())
        for (let i = 0; i < 5; i++) { await ab(0); await ab(1) }
        for (let i = 0; i < 30; i++) { evidence.abMs.push(await ab(i)); store() }
        const slider = async i => sample(() => page.getByRole('slider', { name: '保留原稿位置', exact: true }).press(i % 2 ? 'ArrowLeft' : 'ArrowRight'), true)
        const profiler = benchmark && process.env.HENJI_UI_LAYOUT_PROFILE === '1' ? await page.context().newCDPSession(page) : null
        if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start') }
        for (let i = 0; i < 5; i++) { await slider(0); await slider(1) }
        for (let i = 0; i < 30; i++) { evidence.fidelityMs.push(await slider(i)); store() }
        if (profiler) { fs.writeFileSync(path.join(root, 'fidelity.cpuprofile'), JSON.stringify((await profiler.send('Profiler.stop')).profile)); await profiler.detach() }
        evidence.computeDiagnostics = await page.evaluate(() => window.__layoutComputes)
        const organize = async () => { await choice('原稿').click(); return sample(() => button('整理').click(), true) }
        for (let i = 0; i < 5; i++) await organize()
        for (let i = 0; i < 30; i++) { evidence.candidateMs.push(await organize()); store() }
        evidence.metrics = Object.fromEntries(['candidateMs', 'abMs', 'fidelityMs'].map(k => [k, { p95: quantile(evidence[k], .95), p99: quantile(evidence[k], .99), worst: Math.max(...evidence[k]) }]))
        store()
        if (benchmark) { await choice('等距排列').click(); assert.equal(await page.getByRole('slider', { name: '保留原稿位置', exact: true }).inputValue(), '0'); await shot('100层最终等距') }
        }
        // 同一真实宿主主动启用蒙版后拒绝，不用旧草稿跳过重新采样。
        if (!benchmark) {
        await closePanel(); await select(['hero'])
        await host().getByRole('button', { name: '添加蒙版', exact: true }).click()
        await select(['hero', 'mirror', 'rotate', 'locked'])
        await panel(); if (await choice('原稿').count()) await choice('原稿').click(); await button('整理').click()
        await controls().getByText(/含蒙版图层的可见边缘暂不能整理/).first().waitFor({ timeout: 60000 }); await shot('蒙版拒绝明确提示')
        }
        if (!panelReview) { assert.ok(evidence.metrics.candidateMs.p95 <= 900); assert.ok(evidence.metrics.abMs.p95 <= 100); assert.ok(evidence.metrics.fidelityMs.p95 <= 300) }
      } catch (error) { await capture('failure'); evidence.failure = error.stack; evidence.surface = await host().locator('[data-preview-surface]').evaluate(e => ({ ...e.dataset })).catch(() => null); store(); throw error }
      finally { await restoreExplanation(); await restore() }
    },
  }
}
module.exports = { createImageEditLayoutDraftScene }
