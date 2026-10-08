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
const TRANSITIONS = path.join(ROOT, 'src/core/videoEdit/shaderGraph/transitionKinds.generated.ts')
const REFERENCE_DIR = path.join(ROOT, 'resources/assistant-skills/video-edit-code-creation/references')
const ZH = require('../src/core/videoEdit/shaderGraph/zh.json')
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
    'export const SHADER_COMPONENT_LOADERS: Record<string, () => Promise<{ componentDefinition: unknown }>> = {',
    ...components.filter(value => !value.excluded).map(value => `  ${value.name}: () => import('shaders/core/${value.name}'),`),
    '}',
    '',
  ].join('\n')
  // 一个组件一行：体积小，升级时的差异仍按组件可读。
  const catalogText = `{"package":"shaders","version":${JSON.stringify(catalog.version)},"components":[\n${components.map(value => JSON.stringify(value)).join(',\n')}\n]}\n`
  const transitions = [
    '// 由 scripts/generate-shader-components.cjs 生成，勿手改。剪辑过渡种类要在类型里写全，所以单独生成字面量表。',
    'export const SHADER_GRAPH_TRANSITION_KINDS = [',
    ...components.filter(value => value.role === 'transition' && !value.excluded && !value.usesPointer).map(value => `  'shaders.${value.name}',`),
    '] as const',
    '',
  ].join('\n')
  const usable = components.filter(value => !value.excluded && !value.usesPointer)
  const ROLE = { generator: '生成', filter: '滤镜', transition: '转场', group: '分组' }
  // 助手参考每份不超过 8KB（技能读取上限）：按用途分文件，超出时同一组再续一份。
  const GROUPS = [
    ['textures', '纹理与背景', ['Textures', 'Utilities']], ['shapes', '图形与材质', ['Shapes', 'Shape Effects']],
    ['filters', '模糊、扭曲与调色', ['Blurs', 'Distortions', 'Adjustments']], ['stylize', '风格化与转场', ['Stylize', 'Transitions']],
  ]
  const brief = text => { const first = text.split(/(?<=[.。])\s/)[0]; return first.length > 72 ? `${first.slice(0, 70)}…` : first }
  const propList = value => value.props.filter(prop => prop.ui !== 'none').map(prop => `${prop.key}${prop.key === value.speedProp ? '⏱' : ''}`).join(' ')
  const header = title => [`# 着色器组件：${title}`, '', `由脚本从 shaders ${pkg.version} 生成。代码里写英文组件名；中文名是效果面板名。角色：生成=自己画；滤镜=处理之前画好的图层；转场=剪辑过渡或 layers 里的揭示。⏱ 为速度属性。属性含义与范围读实体 video_edit.builtin_effect（effect:shaders.组件名 / transition:shaders.组件名）。`, '']
  const references = {}
  for (const [slug, title, categories] of GROUPS) {
    const lines = usable.filter(value => categories.includes(value.category)).map(value => `- **${value.name}** ${ZH.components[value.name]?.[0] ?? ''}｜${ROLE[value.role]}｜${brief(value.description)}｜${propList(value)}`)
    let part = 1; let current = header(title)
    const flush = () => { references[part === 1 ? `shader-components-${slug}.md` : `shader-components-${slug}-${part}.md`] = current.join('\n') + '\n'; part++; current = header(`${title}（续）`) }
    for (const line of lines) {
      if (Buffer.byteLength([...current, line].join('\n')) > 7800) flush()
      current.push(line)
    }
    flush()
  }
  const reference = references
  return { catalog: catalogText, loaders, transitions, reference }
}

build().then(({ catalog, loaders, transitions, reference }) => {
  if (process.argv.includes('--check')) {
    const stale = [[CATALOG, catalog], [LOADERS, loaders], [TRANSITIONS, transitions], ...Object.entries(reference).map(([name, text]) => [path.join(REFERENCE_DIR, name), text])].filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text)
    if (stale.length) { console.error(`着色器组件目录已过期，请运行 node scripts/generate-shader-components.cjs：${stale.map(([file]) => path.relative(ROOT, file)).join(', ')}`); process.exit(1) }
    return
  }
  fs.mkdirSync(path.dirname(CATALOG), { recursive: true })
  fs.writeFileSync(CATALOG, catalog)
  fs.writeFileSync(LOADERS, loaders)
  fs.writeFileSync(TRANSITIONS, transitions)
  for (const name of fs.readdirSync(REFERENCE_DIR)) if (name.startsWith('shader-components') && !(name in reference)) fs.rmSync(path.join(REFERENCE_DIR, name))
  for (const [name, text] of Object.entries(reference)) fs.writeFileSync(path.join(REFERENCE_DIR, name), text)
  console.log('已生成着色器组件目录')
}).catch(error => { console.error(error); process.exit(1) })
