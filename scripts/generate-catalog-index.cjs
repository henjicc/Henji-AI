#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const catalogRoot = path.join(repoRoot, 'packages', 'ai-sdk', 'src', 'catalog')
const outputPath = path.join(catalogRoot, 'index.ts')

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
console.log(`[catalog-index] generated ${files.length} explicit imports -> ${outputPath}`)
