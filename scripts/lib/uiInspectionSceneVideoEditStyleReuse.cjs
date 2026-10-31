const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { openVideoEditFile, readVideoEditFile, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { observeWorkers, workerSnapshot } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { assignIsolatedMcpPort, authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')

const names = ['章节标题', '花字节点', '高亮', '数据卡', '录屏容器', '台面背景', 'sample']
const STYLE_ID = 'a8ea502f-df41-4e3f-abac-fc414cd1e44b'
const dataOf = value => value.result?.data ?? value.data
function summary(samples) {
  const numbers = key => samples.map(s => s[key]).filter(Number.isFinite).sort((a, b) => a - b)
  const quantiles = key => { const values = numbers(key); return { median: values[Math.floor(values.length / 2)] ?? null, p90: values[Math.floor(values.length * .9)] ?? null } }
  const total = key => samples.reduce((sum, s) => sum + (s.layers?.[key] ?? 0), 0)
  const reused = total('reused'), redrawn = total('redrawn'), direct = total('direct')
  return { count: samples.length, reuse: reused + redrawn + direct ? reused / (reused + redrawn + direct) : null, reused, redrawn, direct, video: total('video'), uploads: total('uploads'), uploadBytes: total('uploadBytes'), cpuMs: quantiles('cpuMs'), gpuMs: quantiles('gpuMs') }
}

function createVideoEditStyleReuseScene() {
  return { id: 'video-edit-style-reuse', surface: '剪辑', name: '剪辑-组件库静止复用', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve(process.env.HENJI_STYLE_REUSE_ROOT)
      const mode = process.env.HENJI_STYLE_REUSE_MODE ?? 'before'
      const baselineOnly = process.env.HENJI_STYLE_REUSE_BASELINE_ONLY === '1'
      assert.ok(['before', 'after', 'publish'].includes(mode))
      assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '只能使用独立资料实例')
      const variant = process.env.HENJI_STYLE_REUSE_VARIANT ?? ''
      const output = path.join(root, 'evidence', mode + variant); fs.mkdirSync(output, { recursive: true })
      const evidenceFile = path.join(output, 'evidence.json')
      const evidence = process.env.HENJI_STYLE_REUSE_RESUME && fs.existsSync(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile, 'utf8')) : { mode, completed: false, startedAt: new Date().toISOString(), templates: {}, steps: [] }
      evidence.completed = false
      const baselineDifference = (a, b) => Math.abs(a - b) / Math.max(a, b, .1)
      const baselineMean = b => b.samples.reduce((sum, s) => sum + s.cpuMs, 0) / b.samples.length
      evidence.baselineStabilityMetric = '同一132帧工作量两轮CPU均值相差不超过5%；避免0.1ms时钟量化影响亚毫秒中位数；验收仍使用原始中位数/p90'
      for (const record of Object.values(evidence.templates)) {
        if (record.baselines) record.baselineStable = record.baselines.some((b, i, all) => i > 0 && baselineDifference(baselineMean(b), baselineMean(all[i - 1])) <= .05)
      }
      const save = () => fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const browserWindow = await app.browserWindow(page)
      await browserWindow.evaluate(win => win.webContents.setBackgroundThrottling(false))
      evidence.runtime = await app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: await app.getGPUInfo('basic') }))
      let client
      const tool = async (name, args) => callTool(client, name, args, name === 'render_video_edit_style' ? { timeout: 600000 } : undefined)
      const change = async (ref, changes) => {
        const read = await tool('read_application_entity', { ref })
        const result = await tool('change_application_entities', operationEnvelope([read], { summary: '组件库静止复用验收', changes }))
        assert.equal(result.executionState, 'completed', JSON.stringify(result)); return result
      }
      try {
        if (mode === 'publish') {
          // 只把获准的风格库接进独立资料；数据库、设置、工程和连接仍留在隔离实例。
          const base = await page.evaluate(() => window.henjiNative.paths.appLocalDataDir())
          const profile = await app.evaluate(({ app }) => app.getPath('userData'))
          assert.ok(path.resolve(base).startsWith(path.resolve(profile) + path.sep), '风格库接入前必须核实资料隔离')
          const library = path.join(base, 'video-edit-styles')
          assert.ok(path.resolve(library).startsWith(path.resolve(base) + path.sep))
          if (fs.existsSync(library)) fs.renameSync(library, library + '-isolated')
          fs.symlinkSync(path.resolve(process.env.HENJI_STYLE_REUSE_LIBRARY), library, 'junction')
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.waitForFunction(() => Boolean(window.henjiNative))
        }
        await observeWorkers(page)
        await assignIsolatedMcpPort(page)
        const identity = await authorizeMcpConnection(page, { name: '组件库静止复用' })
        client = await connectMcpClient(identity.config, 'Style reuse acceptance')
        if (mode === 'publish') {
          const styleRef = { kind: 'video_edit.style', id: STYLE_ID }
          const backupPath = path.join(root, 'before.hjsty')
          if (!fs.existsSync(backupPath)) evidence.steps.push(await tool('export_video_edit_style_package', operationEnvelope([], { styleRef, path: backupPath })))
          save()
          for (const name of names.filter(name => name !== 'sample')) {
            const template = JSON.parse(fs.readFileSync(path.join(root, 'before', name, 'template.json'), 'utf8'))
            const ref = { kind: 'video_edit.template', id: template.id }
            const body = structuredClone(template.body)
            for (const file of Object.keys(body.code.files)) body.code.files[file] = fs.readFileSync(path.join(root, 'after', name, file), 'utf8')
            const current = await tool('read_application_entity', { ref })
            if (!isDeepStrictEqual(current.data.properties['video_edit.template.body'], body)) evidence.steps.push(await change(ref, [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.template.body': body } }]))
            const read = await tool('read_application_entity', { ref })
            assert.deepEqual(read.data.properties['video_edit.template.body'], body)
            evidence.templates[name] = read; save()
          }
          const style = JSON.parse(fs.readFileSync(path.join(root, 'before', 'style.json'), 'utf8'))
          style.sample.code.files['main.ts'] = fs.readFileSync(path.join(root, 'after', 'sample.ts'), 'utf8')
          const current = await tool('read_application_entity', { ref: styleRef })
          if (!isDeepStrictEqual(current.data.properties['video_edit.style.sample'], style.sample)) evidence.steps.push(await change(styleRef, [{ kind: 'set_properties', entityType: styleRef.kind, target: styleRef, properties: { 'video_edit.style.sample': style.sample } }]))
          save()
          evidence.steps.push(await tool('render_video_edit_style', operationEnvelope([], { styleRef })))
          evidence.style = await tool('read_application_entity', { ref: styleRef })
          assert.equal(evidence.style.data.properties['video_edit.style.stale'], false)
          assert.deepEqual(evidence.style.data.properties['video_edit.style.sample'], style.sample)
          evidence.completed = true; save(); return
        }
        const selected = process.env.HENJI_STYLE_REUSE_NAMES?.split(',') ?? names
        for (const name of selected) {
          if (process.env.HENJI_STYLE_REUSE_RESUME && !process.env.HENJI_STYLE_REUSE_FORCE && (baselineOnly ? evidence.templates[name]?.baselineStable : evidence.templates[name]?.playback.length === 2)) continue
          console.log(`[style-reuse] ${mode} ${name}`)
          const record = evidence.templates[name] = { observations: [], playback: [], pictures: [] }; save()
          const files = name === 'sample' ? { 'main.ts': fs.readFileSync(path.join(root, mode, 'sample.ts'), 'utf8') } : Object.fromEntries(['main.ts', 'kit.ts'].map(file => [file, fs.readFileSync(path.join(root, mode, name, file), 'utf8')]))
          const fixture = videoEditFixtureProject({ id: `style-reuse-${mode}-${names.indexOf(name)}`, name: `${name} ${mode}`, revision: 0, width: 3840, height: 2160, fps: 60, media: [], clips: [], annotations: [] })
          const inputVideo = process.env.HENJI_STYLE_REUSE_VIDEO
          const frozen = process.env.HENJI_STYLE_REUSE_FREEZE === '1'
          if (inputVideo && ['录屏容器', 'sample'].includes(name)) {
            fixture.media.push({ id: 'input-video', name: frozen ? '视频首帧' : '验收视频', kind: frozen ? 'image' : 'video', path: frozen ? path.join(root, 'frozen-input.png') : path.resolve(inputVideo), width: 640, height: 400, durationSeconds: frozen ? 0 : 26, hasAudio: false })
            fixture.items.push({ id: 'input-video-item', name: frozen ? '视频首帧' : '验收视频', kind: frozen ? 'image' : 'video', mediaId: 'input-video' })
          }
          const file = path.join(output, `${name}.json`); fs.writeFileSync(file, JSON.stringify(fixture))
          const opened = await openVideoEditFile(page, file)
          const documentRef = { kind: 'video_edit.document', id: opened.documentId }
          const sequenceRef = { kind: 'video_edit.sequence', id: `${opened.documentId}:${fixture.sequences[0].id}` }
          record.documentRef = documentRef; record.sequenceRef = sequenceRef
          await change(documentRef, [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.render_preference': { autoRender: false }, 'video_edit.document.playback_resolution': { resolution: 'full', fullWhenPaused: true } } }])
          await change(documentRef, [{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.name': name, 'video_edit.code_material.files': files, 'video_edit.code_material.entry': 'main.ts' } }] }])
          let item
          for (let i = 0; i < 100 && !item; i++) { item = readVideoEditFile(file).items.find(item => item.kind === 'code'); if (!item) await page.waitForTimeout(100) }
          assert.ok(item)
          const duration = name === 'sample' ? 1560 : 600
          await change(sequenceRef, [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.kind': 'code', 'video_edit.clip.name': name, 'video_edit.clip.track': 1, 'video_edit.clip.start': 0, 'video_edit.clip.duration': duration } }] }])
          const current = readVideoEditFile(file)
          const clip = current.sequences[0].clips[0]
          const parameters = { ...clip.code.parameters, ...(name === '花字节点' ? { lead: 6 } : {}), ...(name === '数据卡' ? { lead: 4 } : {}), ...(inputVideo && ['录屏容器', 'sample'].includes(name) ? { video: { kind: frozen ? 'image' : 'video', mediaId: 'input-video' } } : {}) }
          const clipRef = { kind: 'video_edit.clip', id: `${opened.documentId}:${clip.id}` }
          await change(clipRef, [{ kind: 'set_properties', entityType: clipRef.kind, target: clipRef, properties: { 'video_edit.clip.code_parameters': parameters } }])
          record.parameters = parameters
          record.parameterReadback = await tool('read_application_entity', { ref: clipRef, propertyIds: ['video_edit.clip.code_parameters'] })
          assert.deepEqual(record.parameterReadback.data.properties['video_edit.clip.code_parameters'], parameters)
          record.version = current.codeMaterials[0].versions[0]
          const playback = (frame, playing) => change(documentRef, [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: 1 } } }])
          const center = name === 'sample' ? 1260 : 220
          const observe = target => tool('observe_video_edit_frame', { documentRef, target: { ...target, sequenceRef }, maxWidth: 3840, ...(target.kind === 'program' ? { saveToAssets: true } : {}) })
          for (const cutFrame of [center - 22, center - 11, center, ...Array.from({ length: 11 }, (_, i) => center + 11 * (i + 1))]) {
            const response = await observe({ kind: 'near_cut', cutFrame, before: 5, after: 5 })
            record.observations.push({ cutFrame, ...dataOf(response) }); save()
          }
          record.summary = summary(record.observations.slice(2).flatMap(o => o.performance ?? []))
          assert.ok(record.summary.count > 0, '零样本不能证明通过')
          assert.ok(record.observations.slice(2).flatMap(o => o.performance ?? []).every(s => s.sampling?.mode === 'adjacent-frame' && s.preparation?.sessionReused), '必须为同一会话相邻帧稳态')
          if (mode === 'after' && ['章节标题', '花字节点', '高亮', '数据卡'].includes(name)) {
            assert.ok(record.summary.reuse >= .99, `${name}沿用率未达99%`)
            assert.equal(record.summary.uploads, 0, `${name}仍在上传`)
            assert.equal(record.summary.uploadBytes, 0)
            if (name === '章节标题') {
              assert.ok(record.summary.cpuMs.median < 2 && record.summary.cpuMs.p90 < 2, '章节标题CPU未达2ms')
            }
          }
          if (mode === 'after' && frozen && name === '录屏容器') {
            assert.equal(record.summary.reuse, 1)
            assert.equal(record.summary.uploads, 0)
            assert.equal(record.summary.uploadBytes, 0)
          }
          for (const frame of baselineOnly ? [] : name === 'sample' ? [30, 220, 480, 800, 1000, 1170, 1260, 1440] : [30, 90, 220, 350, 585, 599]) {
            const response = dataOf(await observe({ kind: 'program', frame }))
            const media = await readAllMedia(client, response.resultRef, { chunkBytes: 262144 })
            const image = path.join(output, `${name}-${frame}.png`); fs.writeFileSync(image, media.bytes)
            record.pictures.push({ frame, image, performance: response.performance }); save()
          }
          if (baselineOnly) {
            record.baselines = []
            for (let round = 0; round < 6; round++) {
              const observations = []
              for (let i = 0; i < 12; i++) observations.push(dataOf(await observe({ kind: 'near_cut', cutFrame: center + i * 11, before: 5, after: 5 })))
              const samples = observations.flatMap(o => o.performance ?? [])
              const measured = summary(samples)
              assert.ok(samples.length > 0)
              record.baselines.push({ round, summary: measured, samples }); save()
              const previous = record.baselines.at(-2)
              if (previous && baselineDifference(baselineMean(previous), baselineMean(record.baselines.at(-1))) <= .05) { record.baselineStable = true; break }
            }
            assert.equal(record.baselineStable, true, `${name}两轮基线CPU差异未收敛到5%`)
          }
          // 同一正式节目 Worker 两轮播放，记录合成耗时与实际漏帧。
          const from = name === 'sample' ? 1200 : 180, to = name === 'sample' ? 1440 : 360
          for (let round = 0; round < (baselineOnly ? 0 : 2); round++) {
            await playback(from, false); await presented(page, from)
            const started = await page.evaluate(() => performance.now())
            await playback(from, true)
            await page.waitForFunction(to => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) >= to, to - 1, { timeout: 60000, polling: 100 })
            await playback(to - 1, false)
            await page.waitForTimeout(100)
            const snapshot = await workerSnapshot(page)
            const workers = new Set(snapshot.workers.filter(w => w.direct && w.sequenceId === fixture.sequences[0].id).map(w => w.id))
            const events = snapshot.events.filter(e => workers.has(e.worker) && e.kind === 'render.completed' && e.at >= started && e.frame >= from && e.frame < to && e.codePerformance?.length)
            const frames = new Set([from, ...events.filter(e => e.presented).map(e => e.frame)])
            const pausedFrame = await page.locator('canvas[aria-label="剪辑画面"]').getAttribute('data-presented-frame')
            record.playback.push({ round, from, to, pausedFrame: Number(pausedFrame), presented: frames.size, dropped: to - from - frames.size, summary: summary(events.flatMap(e => e.codePerformance)), events }); save()
          }
          await capture(`style-reuse-${mode}-${names.indexOf(name)}`)
          const takeover = page.getByRole('button', { name: '接管', exact: true })
          if (await takeover.isVisible().catch(() => false)) await takeover.click()
          await leaveVideoEditProject(page)
        }
        evidence.gpuAfter = await app.evaluate(async ({ app }) => ({ status: app.getGPUFeatureStatus(), info: await app.getGPUInfo('basic') }))
        evidence.adapter = await page.evaluate(async () => { const adapter = await navigator.gpu.requestAdapter(); if (!adapter) throw new Error('没有WebGPU适配器'); const info = adapter.info; return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter } })
        assert.notEqual(evidence.adapter.isFallbackAdapter, true, '不能用软件适配器验收')
        evidence.completed = true; save()
      } finally { save(); if (client) { await client.close(); await disableMcp(page).catch(() => {}) } await browserWindow.dispose() }
    },
  }
}
module.exports = { createVideoEditStyleReuseScene, summary }
