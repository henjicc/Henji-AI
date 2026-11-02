// 用法（在主仓库根目录）：node tickets/35-三维动态性能/prototype/run.cjs <输出目录> [--skip-build] [--only 名称片段]
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url')
const root = process.cwd(), here = __dirname, out = path.resolve(process.argv[2]), compiled = path.resolve('.tmp/t35-proto-build')
const three = path.join(root, 'node_modules/henji-author-three-0.186.1')
const only = (() => { const i = process.argv.indexOf('--only'); return i < 0 ? undefined : process.argv[i + 1] })()
;(async () => {
  const { build } = require('vite')
  if (!process.argv.includes('--skip-build')) await build({ configFile: false, root: here, base: './', logLevel: 'warn',
    resolve: { alias: [
      { find: /^three\/webgpu$/, replacement: path.join(three, 'build/three.webgpu.js') },
      { find: /^three\/tsl$/, replacement: path.join(three, 'build/three.tsl.js') },
      { find: /^three\/addons\/(.*)$/, replacement: path.join(three, 'examples/jsm/$1') },
      { find: /^three$/, replacement: path.join(three, 'build/three.webgpu.js') },
    ] }, build: { outDir: compiled, emptyOutDir: true, minify: false, target: 'esnext' } })
  const { launchElectronApp } = require(path.join(root, 'scripts/lib/electronLaunch.cjs'))
  const session = await launchElectronApp({ mainEntry: path.join(root, 'out/main/index.cjs'), appPath: root, cwd: root, isolateUserData: true, useElectronApi: true, skipOnboarding: true, extraArgs: ['--background', '--enable-unsafe-webgpu'] })
  fs.mkdirSync(out, { recursive: true })
  const evidence = { gpu: await session.app.evaluate(async ({ app }) => (await app.getGPUInfo('basic')).gpuDevice?.find(d => d.active)), runs: [], errors: [] }
  try {
    const page = session.page
    page.on('pageerror', e => evidence.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') evidence.errors.push(m.text().slice(0, 300)) })
    await page.goto(pathToFileURL(path.join(compiled, 'index.html')).href)
    await page.waitForFunction(() => typeof window.runPrototype === 'function', null, { timeout: 120000 })
    const full = { ssr: true, ao: true, dof: true, motionBlur: true, bloom: true, traa: true, shadows: true, particles: 20000, dynamicCards: true }
    const configs = [
      { name: '1080p-全开', width: 1920, height: 1080, ...full, shot: [100, 200] },
      { name: '4K-全开', width: 3840, height: 2160, ...full, shot: [200] },
      { name: '4K-无反射无遮蔽', width: 3840, height: 2160, ...full, ssr: false, ao: false },
      { name: '4K-景深运动模糊泛光阴影', width: 3840, height: 2160, ...full, ssr: false, ao: false, traa: false },
    ]
    const none = { ssr: false, ao: false, dof: false, motionBlur: false, bloom: false, traa: false, shadows: true, particles: 20000, dynamicCards: true }
    const visual = [
      { name: '画面-无后处理', ...none }, { name: '画面-加遮蔽', ...none, ao: true }, { name: '画面-加反射', ...none, ao: true, ssr: true },
      { name: '画面-加泛光', ...none, ao: true, ssr: true, bloom: true }, { name: '画面-加景深', ...none, ao: true, ssr: true, bloom: true, dof: true },
      { name: '画面-加运动模糊', ...none, ao: true, ssr: true, bloom: true, dof: true, motionBlur: true }, { name: '画面-全开', ...full },
    ].map(c => ({ ...c, width: 1920, height: 1080, frames: 1, warmup: 120, shot: [120] }))
    configs.push(...(process.argv.includes('--visual') ? visual : []))
    configs.splice(0, process.argv.includes('--visual') ? 4 : 0)
    configs.splice(0, configs.length, ...configs.filter(c => !only || c.name.includes(only)))
    for (const c of configs) {
      const config = { frames: 240, warmup: 30, pipelineDepth: 2, ...c }
      console.log('START', c.name)
      const run = await page.evaluate(config => window.runPrototype(config), config)
      for (const [i, url] of Object.entries(run.shots)) fs.writeFileSync(path.join(out, `${c.name}-f${i}.png`), Buffer.from(url.split(',')[1], 'base64'))
      delete run.shots
      evidence.runs.push({ name: c.name, ...run }); fs.writeFileSync(path.join(out, 'prototype.json'), JSON.stringify(evidence, null, 1))
      console.log('DONE', c.name, '帧', run.frameP50.toFixed(1), run.frameP95.toFixed(1), 'GPU', run.gpuP50.toFixed(1), run.gpuP95.toFixed(1), 'CPU', run.cpuP50.toFixed(1), '超16ms', (run.over16 * 100).toFixed(1) + '%')
    }
  } finally { await session.close() }
  console.log('ERRORS', evidence.errors.slice(0, 10).join('\n'))
})().catch(e => { console.error(e); process.exitCode = 1 })
