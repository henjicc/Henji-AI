#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const catalogRoot = path.join(repoRoot, 'packages', 'ai-sdk', 'src', 'catalog')
const outputPath = path.join(catalogRoot, 'index.ts')
const packsRoot = path.join(repoRoot, 'packages', 'ai-sdk', 'src', 'packs')
const modelPacksRoot = path.join(packsRoot, 'models')
const providerAdaptersRoot = path.join(packsRoot, 'provider-adapters')
const providerPacksRoot = path.join(packsRoot, 'provider-packs')

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    return entry.name.endsWith('.model.ts') ? [absolute] : []
  })
}

const files = walk(catalogRoot).sort((left, right) => left.localeCompare(right, 'en'))
const imports = files.map((absolute, index) => {
  const relative = `./${path.relative(catalogRoot, absolute).replaceAll(path.sep, '/').replace(/\.ts$/, '')}`
  return `import catalogModel${index + 1} from '${relative}'`
})

const content = [
  '/**',
  ' * 由 scripts/generate-catalog-index.cjs 自动生成。',
  ' * 显式导入保证 catalog 不依赖 Vite 专有目录扫描，可被 UXP/Tauri/Node 打包器消费。',
  ' */',
  '',
  `import type { ModelRuntimeDefinition } from '../types/model'`,
  `import { createModelIndex } from './model-index'`,
  ...imports,
  '',
  `export * from './defineModel'`,
  `export * from './model-index'`,
  `export * from './validate'`,
  `export * from './conditions'`,
  `export * from './consumer-contract'`,
  `export * from './modelscope/customModelRegistry'`,
  '',
  'export const catalog: readonly ModelRuntimeDefinition[] = [',
  ...files.map((_, index) => `  catalogModel${index + 1},`),
  '] as const',
  '',
  'export const catalogIndex = createModelIndex(catalog)',
  '',
]

fs.writeFileSync(outputPath, content.join('\n'))

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true })
}

function writeGenerated(relativePath, lines) {
  const target = path.join(packsRoot, relativePath)
  ensureDirectory(path.dirname(target))
  fs.writeFileSync(target, `${lines.join('\n')}\n`)
}

function providerOf(absolute) {
  return path.relative(catalogRoot, absolute).split(path.sep)[0]
}

function modelStem(absolute) {
  return path.basename(absolute).replace(/\.model\.ts$/, '')
}

function preprocessorOf(provider) {
  if (provider === 'modelscope') return 'kie'
  if (['apimart', 'fal', 'kie', 'ppio'].includes(provider)) return provider
  return 'data-uri'
}

for (const directory of [modelPacksRoot, providerAdaptersRoot, providerPacksRoot]) {
  fs.rmSync(directory, { recursive: true, force: true })
  ensureDirectory(directory)
}

const filesByProvider = new Map()
for (const absolute of files) {
  const provider = providerOf(absolute)
  const providerFiles = filesByProvider.get(provider) ?? []
  providerFiles.push(absolute)
  filesByProvider.set(provider, providerFiles)

  const stem = modelStem(absolute)
  writeGenerated(`models/${provider}/${stem}.ts`, [
    '/** 由 scripts/generate-catalog-index.cjs 自动生成；`pack` 是完整执行单元，`model` 仅供低层目录用途。 */',
    `import model from '../../../catalog/${provider}/${stem}.model'`,
    `import * as adapter from '../../../providers/${provider}'`,
    `import { preprocess } from '../../../upload/provider-preprocessors/${preprocessorOf(provider)}'`,
    `import type { GenerationClientProviderRegistration, GenerationPack } from '../../../generation/core'`,
    '',
    `export { model }`,
    `export const provider: GenerationClientProviderRegistration = { id: '${provider}', adapter, preprocess }`,
    `export const pack: GenerationPack = { models: [model], providers: [provider] }`,
  ])
}

for (const [provider, providerFiles] of [...filesByProvider.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
  writeGenerated(`provider-adapters/${provider}.ts`, [
    '/** 由 scripts/generate-catalog-index.cjs 自动生成；不静态导入任何模型。 */',
    `import * as adapter from '../../providers/${provider}'`,
    `import { preprocess } from '../../upload/provider-preprocessors/${preprocessorOf(provider)}'`,
    `import type { GenerationClientProviderRegistration } from '../../generation/core'`,
    '',
    `export const provider: GenerationClientProviderRegistration = { id: '${provider}', adapter, preprocess }`,
    `export default provider`,
  ])

  const imports = providerFiles.map((absolute, index) => (
    `import model${index + 1} from '../../catalog/${provider}/${modelStem(absolute)}.model'`
  ))
  writeGenerated(`provider-packs/${provider}.ts`, [
    '/** 由 scripts/generate-catalog-index.cjs 自动生成；只聚合当前供应商的真实模型文件。 */',
    ...imports,
    `import { provider } from '../provider-adapters/${provider}'`,
    `import type { GenerationPack } from '../../generation/core'`,
    '',
    `export const models = [${providerFiles.map((_, index) => `model${index + 1}`).join(', ')}] as const`,
    `export const pack: GenerationPack = { models, providers: [provider] }`,
    `export default pack`,
  ])
}

console.log(
  `[catalog-index] generated ${files.length} catalog imports, ${files.length} model packs and ` +
  `${filesByProvider.size} provider packs`
)
