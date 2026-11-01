// 显式专项：隔离正式应用的节目画布、真实播放与播放头拖动；不代表物理显示扫描。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { launchElectronApp } = require('./lib/electronLaunch.cjs')
const { loadTypeScript } = require('./check-persistence-compat.cjs')
const { openVideoEditFixture } = require('./lib/uiInspectionVideoEditDocuments.cjs')
const { observeWorkers, workerSnapshot } = require('./lib/uiInspectionSceneVideoEditLayout.cjs')
const { presented } = require('./lib/uiInspectionSceneVideoEditMonitor.cjs')
const { assignIsolatedMcpPort, authorizeMcpConnection, connectMcpClient, callTool, operationEnvelope, disableMcp } = require('./lib/uiInspectionMcpClient.cjs')

const argument = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3)
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, p50Ms: sorted[Math.floor(sorted.length * .5)] ?? null, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? null, meanMs: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length) }
}
async function main() {
  const root = path.resolve(__dirname, '..'), original = argument('site')
  assert.ok(original && fs.existsSync(path.join(original, 'index.html')), '--site 需要本专项自造页面目录')
  const output = path.join(root, '.artifacts', 'web-time-program', new Date().toISOString().replace(/[:.]/g, '-'))
  const site = path.join(output, 'site'); fs.mkdirSync(site, { recursive: true })
  fs.cpSync(original, site, { recursive: true })
  fs.writeFileSync(path.join(site, 'index.html'), fs.readFileSync(path.join(site, 'index.html'), 'utf8').replace('duration:2', 'duration:3'))
  const preopen = !process.argv.includes('--no-preopen')
  const [width, height] = (argument('size') ?? '1920x1080').split('x').map(Number)
  const source = `export default {name:"网页节目验收",kind:"generator",mode:"dynamic",width:${width},height:${height},durationSeconds:3,params:[{key:"page",type:"image",title:"网页"}],draw(ctx,t,p,w,h,assets){if(assets.page)ctx.drawImage(assets.page,0,0,w,h)}}`
  const hash = createHash('sha256').update(source).digest('hex'), sourceFile = path.join(output, 'main.js')
  fs.writeFileSync(sourceFile, source)
  const { createVideoEditTestDocument } = loadTypeScript('src/core/videoEdit/testFixtures.ts')
  const { makeVideoEditItemClip } = loadTypeScript('src/core/videoEdit/projectItems.ts')
  const fixture = createVideoEditTestDocument('网页节目验收'), sequence = fixture.sequences[0]
  Object.assign(sequence, { width, height, frameRate: { numerator: 30, denominator: 1 } })
  const code = { definitionId: 'program-web', versionId: 'program-web-code', parameters: { page: { kind: 'web', path: site, width, height, scale: 1 } } }
  fixture.codeMaterials = [{ id: code.definitionId, name: '网页', defaultVersionId: code.versionId, versions: [{ id: code.versionId, apiVersion: 4, languageVersion: 4, entry: 'main.js', files: [{ path: 'main.js', location: sourceFile, hash }] }] }]
  fixture.items.push({ id: 'web-item', name: '网页', kind: 'code', code })
  sequence.clips.push(makeVideoEditItemClip(fixture, 'web-item', sequence.id, { frame: 90, duration: 90, track: 1 }, () => ({ mode: 'dynamic', durationSeconds: 3, width, height, parameters: [] })))
  const instance = await launchElectronApp({ mainEntry: path.join(root, 'out/main/index.cjs'), cwd: root, isolateUserData: true, useElectronApi: true, skipOnboarding: true, extraArgs: ['--background'] })
  const evidence = { output, preopen, size: { width, height }, runs: [], scrubs: [], scope: '正式节目画布呈现通知与实际画布帧；非物理屏幕扫描' }
  const save = () => fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
  let client
  const timer = setTimeout(() => { void instance.close() }, 180000)
  try {
    if (!preopen) {
      await instance.page.route('**/assets/videoEditWorker*.js', async route => {
        const response = await route.fetch(), source = await response.text()
        assert.equal((source.match(/webs\.preopen\(/g) ?? []).length, 1, '基线只关闭正式网页预开调用')
        evidence.baselineWorker = { originalSha256: createHash('sha256').update(source).digest('hex'), disabledCalls: 1 }
        await route.fulfill({ response, body: source.replace('webs.preopen(', 'false && webs.preopen(') })
      })
    }
    await observeWorkers(instance.page)
    const opened = await openVideoEditFixture(instance.page, fixture)
    const ref = { kind: 'video_edit.document', id: opened.documentId }
    await assignIsolatedMcpPort(instance.page)
    client = await connectMcpClient((await authorizeMcpConnection(instance.page, { name: '网页节目隔离专项' })).config)
    const playback = async (frame, playing, direction = 1) => {
      const read = await callTool(client, 'read_application_entity', { ref })
      const changed = await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '网页节目专项', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: direction } } }] }))
      assert.equal(changed.executionState, 'completed', JSON.stringify(changed))
    }
    const canvas = instance.page.getByLabel('剪辑画面', { exact: true })
    await canvas.waitFor({ state: 'visible' }); await presented(instance.page, 0)
    await canvas.evaluate(canvas => window.__videoLayoutWatchCanvas(canvas))
    evidence.runtime = await instance.app.evaluate(async ({ app }) => ({ versions: process.versions, gpu: await app.getGPUInfo('basic') }))
    for (let round = 0; round < 3; round++) {
      await playback(0, false); await presented(instance.page, 0)
      const start = await instance.page.evaluate(() => performance.now())
      await playback(0, true)
      await instance.page.waitForTimeout(6200)
      const snapshot = await workerSnapshot(instance.page)
      const workers = new Set(snapshot.workers.filter(worker => worker.direct && worker.sequenceId === sequence.id).map(worker => worker.id))
      const samples = snapshot.events.filter(event => workers.has(event.worker) && event.kind === 'render.completed' && event.at >= start && event.frame >= 90 && event.frame < 180)
      const shown = [...new Map(samples.filter(sample => sample.presented).map(sample => [sample.frame, sample])).values()]
      assert.ok(samples.length, '必须有正式节目渲染样本')
      evidence.runs.push({ round, presented: shown.length, dropped: 90 - shown.length, droppedRatio: (90 - shown.length) / 90, firstValidMsAfterCut: shown.length ? shown[0].at - start - 3000 : null, request: summary(samples.map(sample => sample.elapsedMs)), samples, presentationEvents: snapshot.frames.filter(event => event.at >= start) })
      save()
    }
    for (const frame of [179, 120, 90, 150, 110, 178]) {
      const start = performance.now()
      await playback(frame, false); await presented(instance.page, frame)
      evidence.scrubs.push({ frame, firstValidMs: performance.now() - start, canvas: await canvas.evaluate(canvas => ({ ...canvas.dataset })) })
      save()
    }
    evidence.logs = await instance.page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', limit: 2000 })).events.filter(event => event.level !== 'debug' || /cache\.(hit|miss|selection)/.test(event.event)))
    await canvas.screenshot({ path: path.join(output, 'program.png') })
    evidence.status = 'measured'
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack ?? error); throw error }
  finally { save(); clearTimeout(timer); await client?.close().catch(() => {}); await disableMcp(instance.page).catch(() => {}); await instance.close(); console.log(JSON.stringify({ output, status: evidence.status })) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
