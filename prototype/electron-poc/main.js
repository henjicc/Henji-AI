const { app, BrowserWindow, protocol, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

const TEST_DATA_DIR = path.join(__dirname, 'test-data')
const MEDIA_ROOT = TEST_DATA_DIR

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'henji-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function resolveMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }
  return map[ext] || 'application/octet-stream'
}

function registerMediaProtocol() {
  protocol.handle('henji-media', (request) => {
    const url = new URL(request.url)
    const requestedName = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const filePath = path.join(MEDIA_ROOT, requestedName)

    // 路径安全校验：拒绝越权访问 test-data 之外的文件
    if (!filePath.startsWith(MEDIA_ROOT)) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!fs.existsSync(filePath)) {
      return new Response('Not Found', { status: 404 })
    }

    const stat = fs.statSync(filePath)
    const mime = resolveMimeType(filePath)
    const rangeHeader = request.headers.get('range')

    if (!rangeHeader) {
      const stream = fs.createReadStream(filePath)
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      })
    }

    // 解析 Range: bytes=start-end，支持视频/音频拖动进度条与二次播放
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
    const start = match && match[1] ? Number(match[1]) : 0
    const end = match && match[2] ? Number(match[2]) : stat.size - 1
    const chunkSize = end - start + 1

    const stream = fs.createReadStream(filePath, { start, end })
    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
      },
    })
  })
}

function registerIpc() {
  ipcMain.handle('henji:test-db', () => {
    const dbPath = path.join(TEST_DATA_DIR, 'henji-copy.db')
    const db = new Database(dbPath, { readonly: true })
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((row) => row.name)
      const historyCount = tables.includes('history')
        ? db.prepare('SELECT COUNT(*) AS c FROM history').get().c
        : null
      const sample = tables.includes('history')
        ? db.prepare('SELECT id, provider_id, model_id, status FROM history ORDER BY created_at DESC LIMIT 3').all()
        : []
      return { ok: true, tables, historyCount, sample }
    } finally {
      db.close()
    }
  })

  ipcMain.handle('henji:start-drag', (event, fileName) => {
    const filePath = path.join(TEST_DATA_DIR, fileName)
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'file not found' }
    }
    event.sender.startDrag({
      file: filePath,
      icon: path.join(TEST_DATA_DIR, 'sample-image.png'),
    })
    return { ok: true }
  })

  ipcMain.handle('henji:write-log', (event, payload) => {
    fs.writeFileSync(path.join(__dirname, 'auto-test-result.json'), JSON.stringify(payload, null, 2))
    return { ok: true }
  })

  ipcMain.handle('henji:save-dialog', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win, {
      defaultPath: 'henji-poc-export.png',
    })
    return { ok: !result.canceled, path: result.filePath || null }
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.loadFile('index.html')
  win.webContents.openDevTools({ mode: 'detach' })
}

app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
