#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { spawnSync } = require('child_process')

const packageRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(packageRoot, '..', '..')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-sdk-vite-consumer-'))
const packRoot = path.join(temporaryRoot, 'pack')
const consumerRoot = path.join(temporaryRoot, 'consumer')

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

async function verify() {
  fs.mkdirSync(packRoot, { recursive: true })
  fs.mkdirSync(consumerRoot, { recursive: true })
  const packOutput = JSON.parse(run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    packRoot,
  ], packageRoot))
  const tarballPath = path.join(packRoot, packOutput[0].filename)

  fs.writeFileSync(path.join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'henji-sdk-vite-consumer-probe',
    private: true,
    type: 'module',
  }, null, 2))
  fs.writeFileSync(path.join(consumerRoot, 'index.html'), '<script type="module" src="/entry.js"></script>\n')
  fs.writeFileSync(path.join(consumerRoot, 'entry.js'), [
    "import '@henjicc/ai-sdk'",
    "import '@henjicc/ai-sdk/providers'",
    "import '@henjicc/ai-sdk/catalog'",
    "import '@henjicc/ai-sdk/llm'",
    "import '@henjicc/ai-sdk/runtime'",
    'document.body.dataset.sdkResolved = "true"',
  ].join('\n'))

  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    tarballPath,
  ], consumerRoot)

  const vitePackage = require.resolve('vite/package.json', { paths: [repositoryRoot] })
  const viteEntry = path.join(path.dirname(vitePackage), 'dist', 'node', 'index.js')
  const { createServer } = await import(pathToFileURL(viteEntry).href)
  const server = await createServer({
    root: consumerRoot,
    configFile: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })

  try {
    await server.listen()
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Vite dev server did not expose a TCP port')
    const response = await fetch(`http://127.0.0.1:${address.port}/entry.js`)
    if (!response.ok) throw new Error(`Vite dev entry failed with HTTP ${response.status}: ${await response.text()}`)
    await response.text()

    const entries = [
      '@henjicc/ai-sdk',
      '@henjicc/ai-sdk/providers',
      '@henjicc/ai-sdk/catalog',
      '@henjicc/ai-sdk/llm',
      '@henjicc/ai-sdk/runtime',
    ]
    const resolved = {}
    for (const specifier of entries) {
      const result = await server.pluginContainer.resolveId(
        specifier,
        path.join(consumerRoot, 'entry.js'),
        { ssr: true },
      )
      if (!result?.id) throw new Error(`Vite dev could not resolve ${specifier}`)
      const normalized = result.id.replaceAll('\\', '/')
      if (!normalized.includes('/node_modules/@henjicc/ai-sdk/dist/')) {
        throw new Error(`Vite dev resolved ${specifier} outside published dist: ${result.id}`)
      }
      resolved[specifier] = path.relative(consumerRoot, result.id)
    }
    console.log(`✔ 仓库外标准 Vite dev 已解析 5 个发布入口：${JSON.stringify(resolved)}`)
  } finally {
    await server.close()
  }
}

verify()
  .finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
