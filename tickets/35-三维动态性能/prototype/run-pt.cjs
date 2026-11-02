// 用法（在仓库根目录）：node tickets/35-三维动态性能/prototype/run-pt.cjs <输出目录>
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url')
const root = process.cwd(), here = path.join(__dirname, 'pt'), out = path.resolve(process.argv[2]), compiled = path.resolve('.tmp/t35-pt-build')
// 全部用作者库产物：路径追踪器按相对路径引用同一份 three，原型也必须用这一份，否则是两个 three 实例。
const libs = path.join(root, 'resources/author-libs'), three = path.join(libs, 'three/0.186.1')
;(async () => {
  const { build } = require('vite')
  await build({ configFile: false, root: here, base: './', logLevel: 'warn',
    resolve: { alias: [
      { find: /^three\/webgpu$/, replacement: path.join(three, 'build/three.webgpu.js') },
      { find: /^three\/tsl$/, replacement: path.join(three, 'build/three.tsl.js') },
      { find: /^three\/(?:addons|examples\/jsm)\/(.*)$/, replacement: path.join(three, 'examples/jsm/$1') },
      { find: /^three$/, replacement: path.join(three, 'build/three.webgpu.js') },
      { find: /^three-gpu-pathtracer\/webgpu$/, replacement: path.join(libs, 'three-gpu-pathtracer/0.0.27/webgpu.js') },
    ] }, build: { outDir: compiled, emptyOutDir: true, minify: false, target: 'esnext' } })
  const { launchElectronApp } = require(path.join(root, 'scripts/lib/electronLaunch.cjs'))
  const session = await launchElectronApp({ mainEntry: path.join(root, 'out/main/index.cjs'), appPath: root, cwd: root, isolateUserData: true, useElectronApi: true, skipOnboarding: true, extraArgs: ['--background', '--enable-unsafe-webgpu'] })
  fs.mkdirSync(out, { recursive: true })
  const evidence = { runs: [], errors: [] }
  try {
    const page = session.page
    page.on('pageerror', e => evidence.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') evidence.errors.push(m.text().slice(0, 300)) })
    await page.goto(pathToFileURL(path.join(compiled, 'index.html')).href)
    await page.waitForFunction(() => typeof window.runPathTrace === 'function', null, { timeout: 120000 })
    for (const c of [{ name: '1080p-gpu卡片', width: 1920, height: 1080, samples: [1, 16, 64, 256], external: true }, { name: '1080p-普通贴图', width: 1920, height: 1080, samples: [64], external: false }]) {
      console.log('START', c.name)
      const run = await page.evaluate(config => window.runPathTrace(config), c)
      for (const [i, url] of Object.entries(run.shots)) fs.writeFileSync(path.join(out, `${c.name}-${i}spp.png`), Buffer.from(url.split(',')[1], 'base64'))
      delete run.shots
      evidence.runs.push({ name: c.name, ...run }); fs.writeFileSync(path.join(out, 'pt.json'), JSON.stringify(evidence, null, 1))
      console.log('DONE', c.name, JSON.stringify(run))
    }
  } finally { await session.close() }
  console.log('ERRORS', evidence.errors.slice(0, 10).join('\n'))
})().catch(e => { console.error(e); process.exitCode = 1 })
