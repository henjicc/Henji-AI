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
    "import '@henjicc/ai-sdk/generation'",
    "import '@henjicc/ai-sdk/generation/core'",
    "import '@henjicc/ai-sdk/models/kie/z-image'",
    "import '@henjicc/ai-sdk/provider-adapters/kie'",
    "import '@henjicc/ai-sdk/provider-packs/kie'",
    "import '@henjicc/ai-sdk/catalog'",
    "import '@henjicc/ai-sdk/llm'",
    "import '@henjicc/ai-sdk/llm/streaming'",
    "import '@henjicc/ai-sdk/runtime'",
    "import '@henjicc/ai-sdk/capabilities'",
    "import '@henjicc/ai-sdk/capabilities/speech-recognition'",
    "import '@henjicc/ai-sdk/capabilities/speech-recognition/bailian'",
    "import '@henjicc/ai-sdk/capabilities/translation'",
    "import '@henjicc/ai-sdk/capabilities/realtime'",
    "import '@henjicc/ai-sdk/discovery'",
    "import '@henjicc/ai-sdk/tool-models/fal/bria-eraser'",
    "import '@henjicc/ai-sdk/tool-packs/fal-image-edit-tools'",
    'document.body.dataset.sdkResolved = "true"',
  ].join('\n'))
  fs.writeFileSync(path.join(consumerRoot, 'consumer.ts'), [
    "import { createAIClient, type RuntimeContext } from '@henjicc/ai-sdk'",
    "import { createModularGenerationClient } from '@henjicc/ai-sdk/generation/core'",
    "import { pack as zImagePack } from '@henjicc/ai-sdk/models/kie/z-image'",
    "import { createCapabilityClient, type CapabilityModule } from '@henjicc/ai-sdk/capabilities'",
    "import { defineSpeechRecognitionDescriptor, type SpeechRecognitionModule } from '@henjicc/ai-sdk/capabilities/speech-recognition'",
    "import { createBailianAsrModule, bailianQwen3AsrFlash } from '@henjicc/ai-sdk/capabilities/speech-recognition/bailian'",
    "import { defineTranslationDescriptor, type TranslationModule } from '@henjicc/ai-sdk/capabilities/translation'",
    "import type { CapabilityRealtimeSession } from '@henjicc/ai-sdk/capabilities/realtime'",
    "import { createModelCapabilityDiscovery } from '@henjicc/ai-sdk/discovery'",
    "import { pack as falImageEditTools } from '@henjicc/ai-sdk/tool-packs/fal-image-edit-tools'",
    "import type { LlmChatRequestDto } from '@henjicc/ai-sdk/llm'",
    "import { cancelLlmChatTask, runLlmChatStream, type RuntimeContext as StreamingRuntimeContext } from '@henjicc/ai-sdk/llm/streaming'",
    '',
    'const runtime = {',
    "  transport: { fetch: async () => new Response('{}', { status: 200 }) },",
    '  credentials: { get: async () => undefined },',
    "  media: { read: async () => ({ bytes: new Uint8Array(), mimeType: 'image/png', filename: 'fixture.png' }) },",
    '} satisfies RuntimeContext',
    '',
    'const modular = createModularGenerationClient({ runtime, packs: [zImagePack] })',
    "modular.catalog.get('kie/z-image')",
    "createAIClient({ runtime, generation: { mode: 'modular', packs: [zImagePack] } })",
    'const discovery = createModelCapabilityDiscovery({ generationPacks: [falImageEditTools] })',
    "void discovery.search({ providerIds: 'fal', operations: 'image-edit', features: 'erase' })",
    '',
    'const speechModule: CapabilityModule<{ audio: Uint8Array }, { text: string }> = {',
    "  descriptor: { id: 'fixture-speech', kind: 'speech-recognition', contract: { input: [{ kind: 'audio' }], output: [{ kind: 'text' }] } },",
    "  execute: async (_input, context) => ({ text: context.signal.aborted ? '' : 'ok' }),",
    '}',
    'const capabilities = createCapabilityClient({ runtime, modules: [speechModule] })',
    "void capabilities.get<{ audio: Uint8Array }, { text: string }>('fixture-speech')?.execute({ audio: new Uint8Array() })",
    "const typedSpeech = {} as SpeechRecognitionModule",
    "const typedTranslation = {} as TranslationModule",
    "const typedSession = {} as CapabilityRealtimeSession<Uint8Array, { text: string }>",
    "void defineSpeechRecognitionDescriptor({ id: 'typed-speech', providerIds: ['fixture'], streaming: true })",
    "void defineTranslationDescriptor({ id: 'typed-translation', providerIds: ['fixture'] })",
    'void typedSpeech',
    'void typedTranslation',
    'void typedSession',
    'void createBailianAsrModule(bailianQwen3AsrFlash)',
    'const request = {} as LlmChatRequestDto',
    'const streamingRuntime: StreamingRuntimeContext = runtime',
    'void runLlmChatStream',
    'void cancelLlmChatTask',
    'void streamingRuntime',
    'void request',
  ].join('\n'))
  fs.writeFileSync(path.join(consumerRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      // `ai` 的声明会引用 Node/json-schema 的环境类型；消费方代码与 SDK API 仍按 strict 检查。
      skipLibCheck: true,
    },
    include: ['consumer.ts'],
  }, null, 2))

  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    tarballPath,
  ], consumerRoot)

  const typescriptEntry = require.resolve('typescript/bin/tsc', { paths: [repositoryRoot] })
  run(process.execPath, [typescriptEntry, '--project', 'tsconfig.json'], consumerRoot)
  console.log('✔ 仓库外严格 TypeScript 消费方已通过公开类型检查')

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
      '@henjicc/ai-sdk/generation',
      '@henjicc/ai-sdk/generation/core',
      '@henjicc/ai-sdk/models/kie/z-image',
      '@henjicc/ai-sdk/provider-adapters/kie',
      '@henjicc/ai-sdk/provider-packs/kie',
      '@henjicc/ai-sdk/catalog',
      '@henjicc/ai-sdk/llm',
      '@henjicc/ai-sdk/llm/streaming',
      '@henjicc/ai-sdk/runtime',
      '@henjicc/ai-sdk/capabilities',
      '@henjicc/ai-sdk/capabilities/speech-recognition',
      '@henjicc/ai-sdk/capabilities/speech-recognition/bailian',
      '@henjicc/ai-sdk/capabilities/translation',
      '@henjicc/ai-sdk/capabilities/realtime',
      '@henjicc/ai-sdk/discovery',
      '@henjicc/ai-sdk/tool-models/fal/bria-eraser',
      '@henjicc/ai-sdk/tool-packs/fal-image-edit-tools',
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
    console.log(`✔ 仓库外标准 Vite dev 已解析 ${entries.length} 个发布入口：${JSON.stringify(resolved)}`)
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
