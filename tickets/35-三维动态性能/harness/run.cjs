// 用法（在 Henji-AI-t35 根目录）：node <本文件> <输出目录> [--skip-build] [--only 1080|4k] [--from N --to M]
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url'), { execFileSync } = require('child_process')
const root = process.cwd(), here = __dirname, out = path.resolve(process.argv[2]), compiled = path.resolve('.tmp/t35-attr-build')
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const formal = 'D:/VibeCode/Henji-AI/tickets/16-三维空间/evidence-A/formal'
;(async () => {
  const { build } = require('vite'), { videoEditRenderEngineVersion } = await import(pathToFileURL(path.join(root, 'scripts/vite/renderEngineVersion.mjs')))
  if (!process.argv.includes('--skip-build')) await build({ configFile: false, root: here, base: './', logLevel: 'warn', plugins: [videoEditRenderEngineVersion({ root })], resolve: { alias: { '@': path.join(root, 'src') } }, build: { outDir: compiled, emptyOutDir: true, minify: false }, worker: { format: 'es' } })
  const project = JSON.parse(fs.readFileSync(path.join(formal, 'saved-project.json'), 'utf8'))
  // --scene 换成别的作者场景（复杂测试样片）；版本记录的源码摘要随之更新。
  const scene = fs.readFileSync(arg('--scene') ? path.resolve(arg('--scene')) : path.join(formal, 'harness/scene.ts'), 'utf8')
  if (arg('--scene')) project.codeMaterials[0].versions[0].files[0].hash = require('crypto').createHash('sha256').update(scene).digest('hex')
  const hash = project.codeMaterials[0].versions[0].files[0].hash
  const media = Object.fromEntries(project.media.map(item => [item.id, `data:image/png;base64,${fs.readFileSync(item.path).toString('base64')}`]))
  const { launchElectronApp } = require(path.join(root, 'scripts/lib/electronLaunch.cjs'))
  const session = await launchElectronApp({ mainEntry: path.join(root, 'out/main/index.cjs'), appPath: root, cwd: root, isolateUserData: true, useElectronApi: true, skipOnboarding: true, extraArgs: ['--background', '--enable-unsafe-webgpu'] })
  const evidence = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), completed: false, runtime: await session.app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chromium: process.versions.chrome, gpu: await app.getGPUInfo('basic') })), runs: [], errors: [] }
  fs.mkdirSync(out, { recursive: true })
  const store = () => fs.writeFileSync(path.join(out, 'attribution.json'), JSON.stringify(evidence))
  try {
    const page = session.page
    page.on('pageerror', e => evidence.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') evidence.errors.push(m.text()) })
    await page.goto(pathToFileURL(path.join(compiled, 'index.html')).href)
    await page.waitForFunction(() => typeof window.attribute === 'function', null, { timeout: 120000 }).catch(error => { console.error('页面没有就绪：', evidence.errors.slice(0, 5).join(' | ')); throw error })
    if (arg('--debug')) await page.evaluate(value => { globalThis.__t35Debug = value }, arg('--debug'))
    const from = Number(arg('--from') ?? 0), to = Number(arg('--to') ?? 240), only = arg('--only')
    const quick = process.argv.includes('--quick')
    for (const scale of only === '4k' ? [2] : only === '1080' ? [1] : [1, 2]) for (const motionBlur of quick ? [true] : [true, false]) for (const dof of quick ? [true] : [true, false]) for (const timestamps of quick ? [false] : [true, false]) {
      const config = { scale, motionBlur, dof, timestamps, from, to, quality: arg('--quality') ?? 'interactive', shots: process.argv.includes('--all-shots') ? Array.from({ length: to - from }, (_, i) => from + i) : arg('--shots') ? arg('--shots').split(',').map(Number) : [100, 150, 170, from], ...(arg('--display') ? { display: arg('--display') } : {}), ...(process.argv.includes('--no-warmup') ? { noWarmup: true } : {}), ...(process.argv.includes('--path-trace') ? { pathTrace: true } : {}), ...(process.argv.includes('--transition') ? { transition: arg('--transition') === 'single' ? 'single' : true } : {}), ...(arg('--emission') ? { emission: Object.fromEntries(arg('--emission').split(',').map(pair => [pair.split('=')[0], Number(pair.split('=')[1])])) } : {}), ...(arg('--effects') ? { effects: JSON.parse(arg('--effects')) } : {}) }
      console.log('START', JSON.stringify(config))
      const profiling = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : undefined
      if (profiling) { await profiling.send('Profiler.enable'); await profiling.send('Profiler.setSamplingInterval', { interval: 200 }); await profiling.send('Profiler.start') }
      const run = await page.evaluate(({ project, scene, hash, media, config }) => window.attribute(project, scene, hash, media, config), { project, scene, hash, media, config })
      if (profiling) fs.writeFileSync(path.join(out, 'cpu.cpuprofile'), JSON.stringify((await profiling.send('Profiler.stop')).profile))
      for (const [index, url] of Object.entries(run.shots ?? {})) fs.writeFileSync(path.join(out, `${arg('--display') ?? 'realtime'}-s${scale}-mb${+motionBlur}-dof${+dof}-f${index}.png`), Buffer.from(url.split(',')[1], 'base64'))
      delete run.shots
      const three = run.rows.filter(row => row.frame >= 45 && row.frame < 225).map(row => row.elapsedMs).sort((a, b) => a - b)
      console.log('三维段每帧', 'p50', three[Math.floor(three.length / 2)]?.toFixed(1), 'p95', three[Math.floor(three.length * 0.95)]?.toFixed(1))
      evidence.runs.push(run); store(); console.log('DONE', JSON.stringify(config))
    }
    evidence.completed = true; store()
  } finally { await session.close() }
})().catch(e => { console.error(e); process.exitCode = 1 })
