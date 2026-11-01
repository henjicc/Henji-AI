const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const http = require('node:http')

// 专项独立进程只使用临时 profile，不连接用户的开发实例。
const args = process.argv.slice(2)
const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
if (args.includes('--help')) {
  console.log('显卡恢复后运行：node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-dom/index.html --out .tmp/text-layout-dom/dom.json')
} else if (!value('--page') || !value('--out')) {
  throw new Error('必须指定 --page 和 --out；本命令会启动 Electron，显卡暂停期间禁止执行')
} else if (!process.versions.electron) {
  const child = spawn(require('electron'), [__filename, ...args], { stdio: 'inherit', windowsHide: true })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} else {
  const { app, BrowserWindow } = require('electron')
  // 使用独立的临时 profile，不进入真实应用资料目录。
  app.setPath('userData', path.resolve(path.dirname(value('--out')), 'electron-profile'))
  app.commandLine.appendSwitch('enable-precise-memory-info')
  app.commandLine.appendSwitch('js-flags', '--expose-gc')
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
    const page = path.resolve(value('--page')), base = path.dirname(page)
    const server = http.createServer((request, response) => {
      const file = path.resolve(base, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
      if (!file.startsWith(base + path.sep)) { response.writeHead(403); response.end(); return }
      response.setHeader('Content-Type', file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.json') ? 'application/json' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream')
      const stream = fs.createReadStream(file); stream.on('error', () => { response.statusCode = 404; response.end() }); stream.pipe(response)
    })
    const memory = [], memoryTimer = setInterval(() => memory.push({ at: Date.now(), processes: app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, memory })) }), 500)
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      await window.loadURL(`http://127.0.0.1:${server.address().port}/${path.basename(page)}${value('--phase') ? `?phase=${encodeURIComponent(value('--phase'))}` : ''}`)
      const result = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 300000;
        const check = () => {
          if (window.textLayoutExperimentResult) resolve(window.textLayoutExperimentResult);
          else if (Date.now() > deadline) reject(new Error('DOM 实验未在 300 秒内产出结果'));
          else setTimeout(check, 50);
        }; check();
      })`)
      const out = path.resolve(value('--out'))
      if (result.domFontChecks) {
        window.webContents.debugger.attach('1.3')
        try {
          await window.webContents.debugger.sendCommand('DOM.enable')
          await window.webContents.debugger.sendCommand('CSS.enable')
          const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument')
          for (const check of result.domFontChecks) {
            const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: check.selector })
            const { fonts } = await window.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId })
            check.actual = fonts
            check.passed = fonts.length > 0 && fonts.every(font => check.expected.some(names => names.some(name => name.toLowerCase() === font.familyName.toLowerCase())))
            if (!check.passed) { result.gate.passed = false; result.gate.failures.push(`${check.caseId}: DOM 实际字体与 Worker 不同：${JSON.stringify(fonts)}`) }
          }
        } finally { window.webContents.debugger.detach() }
      }
      fs.mkdirSync(path.dirname(out), { recursive: true })
      if (result.captures) {
        const directory = path.join(path.dirname(out), path.basename(out, '.json') + '-captures')
        fs.mkdirSync(directory, { recursive: true })
        for (const capture of result.captures) {
          const filename = path.join(directory, `${path.basename(capture.name)}.png`)
          fs.writeFileSync(filename, Buffer.from(capture.dataUrl.split(',')[1], 'base64'))
          delete capture.dataUrl; capture.path = filename
        }
      }
      if (result.experiment3) {
        const captures = path.join(path.dirname(out), 'punctuation')
        fs.mkdirSync(captures, { recursive: true })
        for (const [index, item] of result.experiment3.cases.entries()) {
          const shots = {}
          for (const mode of ['dom', 'hb', 'overlay']) {
            await window.webContents.executeJavaScript(`window.renderTextPunctuation(${index}, ${JSON.stringify(mode)})`)
            await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            const capture = await window.webContents.capturePage({ x: 0, y: 0, width: item.width, height: item.height })
            fs.writeFileSync(path.join(captures, `${index}-${mode}.png`), capture.toPNG())
            shots[mode] = capture
          }
          const size = shots.dom.getSize(), ratio = size.width / item.width
          const pixels = { dom: shots.dom.toBitmap(), hb: shots.hb.toBitmap() }
          const bounds = (data, left, right) => {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0
            for (let y = 0; y < size.height; y++) for (let x = Math.max(0, Math.floor(left)); x < Math.min(size.width, Math.ceil(right)); x++) {
              const at = (y * size.width + x) * 4
              if (data[at] < 128 && data[at + 1] < 128 && data[at + 2] < 128) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++ }
            }
            return count ? { minX, maxX, minY, maxY, count } : null
          }
          item.ink = item.positions.map(position => {
            const left = (12 + position.domX) * item.scale * ratio, right = left + position.domWidth * item.scale * ratio
            return { text: position.text, dom: bounds(pixels.dom, left, right), hb: bounds(pixels.hb, left, right) }
          })
          item.capture = { directory: captures, index, size, ratio }
        }
        result.experiment3.geometryPassed = result.experiment3.cases.every(item => item.positions.every(position => Math.abs(position.domX - position.hbX) <= 1 / 32 && Math.abs(position.domWidth - position.hbWidth) <= 1 / 32) && item.restingDifferentChannels === 0)
        result.experiment3.inkCaptured = result.experiment3.cases.every(item => item.ink.every(ink => ink.dom && ink.hb))
        result.experiment3.visualReview = '须打开叠图区分位置与抗锯齿差异；自动检查不代替目视'
      }
      const jsHeap = await window.webContents.executeJavaScript('performance.memory && {used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}')
      fs.writeFileSync(out, JSON.stringify({ ...result, memory: { processes: memory, rendererJsHeap: jsHeap }, electron: process.versions.electron, chromium: process.versions.chrome }, null, 2))
      if (value('--screenshot')) fs.writeFileSync(path.resolve(value('--screenshot')), (await window.webContents.capturePage()).toPNG())
      const failed = result.cases.filter(item => (Array.isArray(item.missing) ? item.missing.length : item.missing) || !item.breaksMatch || !item.geometryMatch)
      const incomplete = result.thresholds && (result.cases.length !== 200 || result.thresholds.length !== 600)
      const thresholdsFailed = result.thresholds?.some(item => !item.breaksMatch || typeof item.error !== 'number' || item.error > 1 / 64)
      const appearanceFailed = result.appearance && (!result.appearance.inkChannels || result.appearance.directReplayDifferentChannels || !result.appearance.comparable || result.appearance.density.some((item, index) => index % 2 === 1 && item.allocations.length))
      const drawingFailed = result.drawing && (!result.drawing.inkChannels || result.drawing.restingDifferentChannels || !result.drawing.comparable)
      const punctuationFailed = result.experiment3 && (!result.experiment3.geometryPassed || !result.experiment3.inkCaptured)
      const hyphenFailed = result.softHyphenDrawing?.some(item => !item.inkChannels || item.advance <= 0)
      console.log(`DOM 对照 ${result.cases.length} 例，失败 ${failed.length} 例；结果：${out}`)
      if (result.fatal) console.error(result.fatal)
      if (result.gate) console.log(`11-01 门槛：${JSON.stringify(result.gate)}`)
      const comparisonFailed = result.gate ? !result.gate.passed : failed.length || thresholdsFailed
      server.close(); app.exit(comparisonFailed || result.fatal || incomplete || drawingFailed || appearanceFailed || punctuationFailed || hyphenFailed ? 1 : 0)
    } finally { clearInterval(memoryTimer); server.close(); if (!window.isDestroyed()) window.destroy() }
  }).catch(error => { console.error(error); app.exit(1) })
}
