#!/usr/bin/env node
/**
 * 从 gl-transitions 包（https://github.com/gl-transitions/gl-transitions，MIT）生成剪辑视频过渡 `gl.<名>`：
 * 收录目录（作者、许可、参数、uniform 布局）与改好的 WGSL。包不是运行时依赖：着色器以生成文件进仓库，保留作者与许可。
 *
 * 收录与排除只登记在 src/core/videoEdit/glTransitions/zh.json：每个转场必须在 transitions（收录，带中文名与参数说明）
 * 或 excluded（不收，写原因：与已有转场重复、需要额外贴图、核验未过）之一，升级包版本时新增的转场会让脚本报错，逼着逐个决定。
 * 收录前先跑 scripts/verify-gl-transitions.mjs（两端逐像素、中间帧对照 GLSL 参考渲染），未通过的写进 excluded。
 *
 *   node scripts/generate-gl-transitions.cjs                    下载固定版本的包到临时目录后生成
 *   node scripts/generate-gl-transitions.cjs --from <包目录>     用已解压的包目录（含 package.json、wgsl/、layouts.json）
 *   加 --check                                                  只校验生成物是否最新
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { adaptGlTransitionWgsl } = require('./lib/glTransitionWgsl.cjs')

const VERSION = '2.0.0'
const ROOT = path.resolve(__dirname, '..')
const CURATION = path.join(ROOT, 'src/core/videoEdit/glTransitions/zh.json')
const CATALOG = path.join(ROOT, 'src/core/videoEdit/glTransitions/catalog.generated.ts')
const SHADERS = path.join(ROOT, 'src/features/videoEdit/engine/glTransitions/glTransitionShaders.generated.ts')

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }

function packageDir() {
  const given = argument('--from')
  if (given) return path.resolve(given)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-transitions-'))
  // 版本是本文件里的常量，整条命令交给 shell（Windows 上 npm 是 .cmd）。
  const pack = spawnSync(`npm pack gl-transitions@${VERSION} --silent`, { cwd: dir, encoding: 'utf8', shell: true })
  if (pack.status !== 0) throw new Error(`npm pack 失败：${pack.stderr}`)
  const tarball = pack.stdout.trim().split(/\r?\n/).pop()
  const untar = spawnSync('tar', ['-xzf', tarball], { cwd: dir, encoding: 'utf8' })
  if (untar.status !== 0) throw new Error(`解压失败：${untar.stderr}`)
  return path.join(dir, 'package')
}

/** 参数在 uniform 里的类型：包里 bool 是 i32。 */
const TYPES = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'ivec2'])

function build(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (pkg.name !== 'gl-transitions' || pkg.version !== VERSION) throw new Error(`需要 gl-transitions@${VERSION}，拿到 ${pkg.name}@${pkg.version}`)
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'gl-transitions.json'), 'utf8'))
  const layouts = JSON.parse(fs.readFileSync(path.join(dir, 'layouts.json'), 'utf8'))
  const curation = JSON.parse(fs.readFileSync(CURATION, 'utf8'))
  const names = new Set(all.map(value => value.name))
  const problems = []
  for (const value of all) {
    const listed = Number(value.name in curation.transitions) + Number(value.name in curation.excluded)
    if (listed !== 1) problems.push(`${value.name} 必须且只能出现在 zh.json 的 transitions 或 excluded 之一`)
  }
  for (const name of [...Object.keys(curation.transitions), ...Object.keys(curation.excluded)]) if (!names.has(name)) problems.push(`zh.json 里的 ${name} 不在包里`)
  const included = all.filter(value => value.name in curation.transitions).sort((a, b) => a.name.localeCompare(b.name))
  const catalog = []; const shaders = []
  for (const value of included) {
    const curated = curation.transitions[value.name]
    if (!curation.groups[curated.group]) problems.push(`${value.name} 的分组 ${curated.group} 未登记`)
    if (value.textures?.length) problems.push(`${value.name} 需要额外贴图，不能收录`)
    const layout = layouts[value.name]
    const declared = layout.uniforms.slice(2).map(uniform => uniform.name)
    if (layout.uniforms[0]?.name !== 'progress' || layout.uniforms[1]?.name !== 'ratio' || declared.join() !== Object.keys(value.params).join()) problems.push(`${value.name} 的 uniform 布局与参数表不一致`)
    for (const [key, param] of Object.entries(value.params)) if (!TYPES.has(param.type)) problems.push(`${value.name}.${key} 的类型 ${param.type} 未支持`)
    for (const key of Object.keys(curated.params ?? {})) if (!(key in value.params)) problems.push(`zh.json 里 ${value.name} 的参数 ${key} 不存在`)
    catalog.push({
      name: value.name, author: value.author, license: value.license, description: value.description ?? '', tags: value.tags ?? [],
      params: Object.entries(value.params).map(([key, param]) => ({ key, type: param.type, default: param.default, ...(param.min !== undefined ? { min: param.min } : {}), ...(param.max !== undefined ? { max: param.max } : {}), ...(param.step !== undefined ? { step: param.step } : {}), ...(param.color ? { color: true } : {}), description: param.description ?? '' })),
      uniforms: layout.uniforms.map(uniform => ({ name: uniform.name, type: uniform.type, offset: uniform.offset })), size: layout.size,
    })
    const source = fs.readFileSync(path.join(dir, 'wgsl', `${value.name}.wgsl`), 'utf8')
    // MIT 以外的许可（目前只有 BSD）要求随源码保留原版权与许可全文：把 GLSL 源里的注释原样带上。
    const notice = value.license === 'MIT' ? '' : `${fs.readFileSync(path.join(dir, 'transitions', `${value.name}.glsl`), 'utf8').split(/\r?\n/).filter(line => /^\s*\/\//.test(line)).join('\n')}\n`
    try { shaders.push([value.name, notice + adaptGlTransitionWgsl(value.name, source)]) } catch (error) { problems.push(error.message) }
  }
  if (problems.length) throw new Error(`gl-transitions 生成失败：\n- ${problems.join('\n- ')}`)
  const header = `// 由 scripts/generate-gl-transitions.cjs 从 gl-transitions@${VERSION}（MIT，${pkg.homepage}）生成，勿手改。`
  const catalogText = [
    header,
    '// 每个转场的作者与许可见 author / license；收录与排除原因登记在同目录 zh.json。',
    `export const GL_TRANSITIONS_PACKAGE = { name: 'gl-transitions', version: '${VERSION}', license: 'MIT', homepage: '${pkg.homepage}' } as const`,
    'export const GL_TRANSITION_KINDS = [',
    ...catalog.map(value => `  'gl.${value.name}',`),
    '] as const',
    "export type GlTransitionParamType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'ivec2'",
    '/** 包里的参数：顺序即 uniform 声明顺序；min/max/step 是上游建议的界面范围，color 表示是颜色。 */',
    'export interface GlTransitionCatalogParam { key: string; type: GlTransitionParamType; default: number | boolean | readonly number[]; min?: number; max?: number; step?: number; color?: boolean; description: string }',
    '/** uniform 缓冲布局（字节偏移，WGSL uniform 布局）：前两项固定是 progress、ratio。 */',
    'export interface GlTransitionCatalogEntry { name: string; author: string; license: string; description: string; tags: readonly string[]; params: readonly GlTransitionCatalogParam[]; uniforms: ReadonlyArray<{ name: string; type: GlTransitionParamType; offset: number }>; size: number }',
    'export const GL_TRANSITION_CATALOG: readonly GlTransitionCatalogEntry[] = [',
    ...catalog.map(value => `  ${JSON.stringify(value)},`),
    ']',
    '',
  ].join('\n')
  const shaderText = [
    header,
    '// 每段着色器开头保留上游的来源、作者与许可注释；主体是包里的 WGSL 原样，只改了入口与预乘透明度（scripts/lib/glTransitionWgsl.cjs）。',
    'export const GL_TRANSITION_WGSL: Readonly<Record<string, string>> = {',
    ...shaders.map(([name, code]) => `  ${name}: ${JSON.stringify(code)},`),
    '}',
    '',
  ].join('\n')
  return { catalogText, shaderText, count: catalog.length }
}

try {
  const { catalogText, shaderText, count } = build(packageDir())
  if (process.argv.includes('--check')) {
    const stale = [[CATALOG, catalogText], [SHADERS, shaderText]].filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text)
    if (stale.length) { console.error(`GL 转场生成物已过期，请运行 node scripts/generate-gl-transitions.cjs：${stale.map(([file]) => path.relative(ROOT, file)).join(', ')}`); process.exit(1) }
  } else {
    fs.mkdirSync(path.dirname(SHADERS), { recursive: true })
    fs.writeFileSync(CATALOG, catalogText)
    fs.writeFileSync(SHADERS, shaderText)
    console.log(`已生成 ${count} 个 GL 转场`)
  }
} catch (error) { console.error(error.message ?? error); process.exit(1) }
