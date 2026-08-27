const { app, safeStorage } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const EXAMPLES = {
  'minimal-node': {
    storeKey: 'ai:kie',
    envKey: 'KIE_API_KEY',
    entry: 'packages/ai-sdk/examples/minimal-node/dist/index.js',
  },
  'llm-chat': {
    storeKey: 'llm:deepseek',
    envKey: 'LLM_API_KEY',
    entry: 'packages/ai-sdk/examples/llm-chat/dist/index.js',
    env: {
      LLM_PROVIDER_ID: 'deepseek',
      LLM_MODEL_ID: 'deepseek-v4-flash',
      LLM_BASE_URL: 'https://api.deepseek.com',
    },
  },
}

// 开发态 Electron 脚本默认会落到 `Electron/` profile；正式应用使用 package name
// `henji-ai/`。safeStorage 的加密材料位于既有 userData/sessionData，必须在 ready 前
// 指向真实 profile，不能只猜密文文件的位置。
app.setName('henji-ai')
const realProfilePath = path.join(app.getPath('appData'), 'henji-ai')
app.setPath('userData', realProfilePath)
app.setPath('sessionData', realProfilePath)

function readEncryptedValue(storeKey) {
  const storePath = path.join(
    app.getPath('appData'),
    'com.henji.ai',
    'Henji-AI',
    'provider-keys.enc.json',
  )
  const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  const encrypted = parsed?.version === 1 ? parsed.keys?.[storeKey] : undefined
  if (typeof encrypted !== 'string' || !encrypted) {
    throw new Error(`未找到 ${storeKey} 的既有凭据`)
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage 当前不可用')
  }
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

function writeSanitized(stream, chunk, secret) {
  const safe = String(chunk).split(secret).join('[REDACTED]')
  stream.write(safe)
}

async function main() {
  const targetName = process.argv[2]
  const target = EXAMPLES[targetName]
  if (!target) {
    throw new Error(`用法: electron scripts/validate-sdk-example-live.cjs <${Object.keys(EXAMPLES).join('|')}>`)
  }

  await app.whenReady()
  const secret = readEncryptedValue(target.storeKey)
  if (process.argv.includes('--check-credential')) {
    process.stdout.write(`${JSON.stringify({ target: targetName, credential: 'available', networkCalls: 0 })}\n`)
    return
  }
  const entry = path.join(__dirname, '..', target.entry)
  if (!fs.existsSync(entry)) {
    throw new Error(`示例尚未构建: ${entry}`)
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, '--live'], {
      cwd: path.dirname(entry),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ...target.env,
        [target.envKey]: secret,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => writeSanitized(process.stdout, chunk, secret))
    child.stderr.on('data', (chunk) => writeSanitized(process.stderr, chunk, secret))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`示例退出: code=${String(code)} signal=${String(signal)}`))
    })
  })
}

void main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => app.quit())
