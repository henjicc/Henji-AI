#!/usr/bin/env node
/**
 * 从 `shaders` 包的组件注册表生成着色器组件目录（名称、分类、角色、参数元数据）与按需加载表。
 * 目录是助手、效果面板和代码素材共用的唯一数据源；升级 `shaders` 版本后重跑本脚本。
 *
 *   node scripts/generate-shader-components.cjs           生成
 *   node scripts/generate-shader-components.cjs --check   只校验生成物是否最新（CI）
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const CATALOG = path.join(ROOT, 'src/core/videoEdit/shaderGraph/components.generated.json')
const LOADERS = path.join(ROOT, 'src/features/videoEdit/engine/shaderEngines/componentLoaders.generated.ts')
const EXCLUSIONS = require('./shader-component-exclusions.cjs')

function plain(value) {
  if (value === undefined || typeof value === 'function') return undefined
  return JSON.parse(JSON.stringify(value))
}

function prop(key, config) {
  const ui = config.ui ?? {}
  const types = Array.isArray(ui.type) ? ui.type : [ui.type ?? 'none']
  const options = Array.isArray(ui.options) ? ui.options.map(option => typeof option === 'object' ? { value: plain(option.value), label: String(option.label ?? option.value) } : { value: plain(option), label: String(option) }) : undefined
  return {
    key,
    ui: types[0] ?? 'none',
    mappable: types.includes('map') || undefined,
    label: ui.label ?? key,
    description: config.description ?? '',
    default: plain(config.default),
    min: typeof ui.min === 'number' ? ui.min : undefined,
    max: typeof ui.max === 'number' ? ui.max : undefined,
    step: typeof ui.step === 'number' ? ui.step : undefined,
    options,
    compileTime: config.compileTime === true || undefined,
  }
}

async function build() {
  const { getAllShaders } = await import('shaders/registry')
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/shaders/package.json'), 'utf8'))
  const components = getAllShaders()
    .map(entry => {
      const definition = entry.definition
      const role = definition.category === 'Transitions' ? 'transition' : definition.name === 'Group' ? 'group' : definition.requiresChild ? 'filter' : 'generator'
      const excluded = EXCLUSIONS[definition.name]
      return {
        name: definition.name,
        category: definition.category,
        description: definition.description ?? '',
        role,
        speedProp: definition.animatedTime?.speed,
        usesPointer: definition.usesPointer === true || undefined,
        excluded: excluded ?? undefined,
        props: Object.entries(definition.props).map(([key, config]) => prop(key, config)),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const catalog = { package: 'shaders', version: pkg.version, components }
  const loaders = [
    '// 由 scripts/generate-shader-components.cjs 生成，勿手改。',
    '/* eslint-disable */',
    'export const SHADER_COMPONENT_LOADERS: Record<string, () => Promise<{ componentDefinition: unknown }>> = {',
    ...components.filter(value => !value.excluded).map(value => `  ${value.name}: () => import('shaders/core/${value.name}'),`),
    '}',
    '',
  ].join('\n')
  // 一个组件一行：体积小，升级时的差异仍按组件可读。
  const catalogText = `{"package":"shaders","version":${JSON.stringify(catalog.version)},"components":[\n${components.map(value => JSON.stringify(value)).join(',\n')}\n]}\n`
  return { catalog: catalogText, loaders }
}

build().then(({ catalog, loaders }) => {
  if (process.argv.includes('--check')) {
    const stale = [[CATALOG, catalog], [LOADERS, loaders]].filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text)
    if (stale.length) { console.error(`着色器组件目录已过期，请运行 node scripts/generate-shader-components.cjs：${stale.map(([file]) => path.relative(ROOT, file)).join(', ')}`); process.exit(1) }
    return
  }
  fs.mkdirSync(path.dirname(CATALOG), { recursive: true })
  fs.writeFileSync(CATALOG, catalog)
  fs.writeFileSync(LOADERS, loaders)
  console.log('已生成着色器组件目录')
}).catch(error => { console.error(error); process.exit(1) })
