#!/usr/bin/env node
/**
 * 生成代码效果的内置第三方库：resources/author-libs/<库名>/<版本>/（不入 Git，构建时生成）。
 *
 * 库名、版本、入口、类型与许可只登记在 src/core/videoEdit/codeMaterial/authorLibraries.ts；本脚本只决定从
 * npm 别名包 `henji-author-<库名>-<版本>` 拷哪些文件。自家库只核验、复制冻结目录，绝不重新编译最新源码。
 * 第三方库内部的裸名按同一份登记改成相对路径，再压缩；导入登记为库依赖的其他内置库时，改成指向那一版目录的相对路径。
 * 渲染 Worker 里没有 import map，产物残留任何裸名或 http(s) 导入都无法加载，所以发现即失败。
 * 随库的第三方组件只登记在 scripts/third-party-licenses/author-libs/components.json，许可全文写进各版本的 NOTICE.txt。
 * 作者类型检查用的声明打成同目录的 types.json，由源码检查 Worker 按需读取。
 *
 * 用法：node scripts/build-author-libraries.ts [--force]
 * 输入指纹（本脚本、登记表、随库组件表与许可、来源包、类型来源、打包工具版本）未变化且产物齐全时直接跳过。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild-wasm'
import { parse } from 'es-module-lexer/js'
import { readFrozenAuthorRelease } from './lib/frozenAuthorLibraries.ts'
import {
  AUTHOR_LIBRARIES,
  AUTHOR_LIBRARY_LICENSES,
  AUTHOR_LIBRARY_TYPES_FILE,
  authorLibraryPackageName,
  authorLibraryTypesPackageName,
  resolveAuthorLibraryModule,
  type AuthorLibraryRelease,
} from '../src/core/videoEdit/codeMaterial/authorLibraries.ts'

interface LibraryPlan {
  /** 版本目录内路径 → 来源包内路径；必须全部成功生成。 */
  files: Record<string, string>
  /** 来源包内目录 → 白名单子目录；整个依赖闭包都合格的文件才收入，否则排除并列出原因。 */
  directories?: Record<string, string[]>
  /** 版本目录内路径 → 本脚本生成的入口源码（上游入口带着不随包的部分时，另写一个只导出随包部分的入口）。 */
  entries?: Record<string, string>
  /**
   * 补丁版（版本号带 `-henji.N`）：别名包装的是上游 `upstream` 版，安装时 patch-package 按 `patch` 改过源码。
   * 构建前核对补丁确实打上了（`marker` 文件里含 `henji:` 注释），补丁文件计入构建指纹。
   * 作者库地址按版本长期缓存，已发行的补丁版内容不可变：补丁内容一旦改变，版本号必须升到下一个 `-henji.N`。
   */
  patched?: { upstream: string; patch: string; marker: string }
}

const PLANS: Record<string, LibraryPlan> = {
  'three@0.186.1': {
    files: {
      'build/three.core.js': 'build/three.core.js',
      'build/three.module.js': 'build/three.module.js',
      'build/three.webgpu.js': 'build/three.webgpu.js',
      'build/three.tsl.js': 'build/three.tsl.js',
    },
    // 只收能在渲染 Worker 里离线工作的部分：控制器、交互、WebXR、调试面板、CSS/SVG 渲染器依赖 DOM 或输入设备，
    // 物理与解码器要从网络或固定路径加载 wasm，导出器不参与画面。
    directories: {
      'examples/jsm/': [
        'animation', 'csm', 'curves', 'effects', 'environments', 'generators', 'geometries', 'gpgpu', 'helpers',
        'lighting', 'lights', 'lines', 'loaders', 'materials', 'math', 'misc', 'modifiers', 'objects',
        'postprocessing', 'shaders', 'textures', 'tsl', 'utils',
      ],
    },
  },
  'opentype.js@2.0.0': {
    files: { 'opentype.mjs': 'dist/opentype.mjs' },
  },
  // workers/ 要自己起 Worker 加载脚本，渲染 Worker 里用不上。
  'three-mesh-bvh@0.9.17': {
    files: { 'src/index.js': 'src/index.js', 'src/webgpu/index.js': 'src/webgpu/index.js' },
    directories: { 'src/': ['core', 'debug', 'math', 'objects', 'utils', 'webgl', 'webgpu'] },
  },
  'three-gpu-pathtracer@0.0.27': {
    files: {},
    directories: { 'src/': ['core', 'materials', 'objects', 'shader', 'textures', 'uniforms', 'utils', 'webgpu'] },
    // 上游 webgpu 入口还导出 OIDN 降噪与 FSR 超分，它们要从网络加载模型与 wasm；webgpu 入口只导出路径追踪器与它的相机、灯光，并保留相机扩展的副作用导入。
    entries: {
      'webgpu.js': [
        "export * from './src/webgpu/WebGPUPathTracer.js';",
        "export * from './src/webgpu/BlurredEnvMapGenerator.js';",
        "export * from './src/webgpu/constants.js';",
        "export * from './src/webgpu/materials/RenderToScreenMaterial.js';",
        "export * from './src/objects/PhysicalCamera.js';",
        "export * from './src/objects/EquirectCamera.js';",
        "export * from './src/objects/PhysicalSpotLight.js';",
        "export * from './src/objects/ShapedAreaLight.js';",
        "import './src/webgpu/shims/EquirectCameraShim.js';",
        "import './src/webgpu/shims/PhysicalCameraShim.js';",
        "import './src/webgpu/shims/ArrayCameraShim.js';",
      ].join('\n'),
      // OIDN 降噪封装单独一个入口：模型权重由宿主下载后交给它，加载路径追踪器时不连带加载。
      'denoise.js': "export * from './src/webgpu/denoise/OIDNDenoiser.js';",
    },
  },
  // 宿主自用的补丁版（patches/henji-author-three-gpu-pathtracer-0.0.27-henji.1+0.0.27.patch）：材质贴图图集半精度（8 位线性暗部有台阶），
  // matte 判断移到半透明随机穿透之后（半透明 matte 纹素保留覆盖率）。入口与 0.0.27 相同。
  'three-gpu-pathtracer@0.0.27-henji.1': {
    patched: { upstream: '0.0.27', patch: 'patches/henji-author-three-gpu-pathtracer-0.0.27-henji.1+0.0.27.patch', marker: 'src/webgpu/nodes/PathtracerBVHComputeData.js' },
    files: {},
    directories: { 'src/': ['core', 'materials', 'objects', 'shader', 'textures', 'uniforms', 'utils', 'webgpu'] },
    // 上游 webgpu 入口还导出 OIDN 降噪与 FSR 超分，它们要从网络加载模型与 wasm；webgpu 入口只导出路径追踪器与它的相机、灯光，并保留相机扩展的副作用导入。
    entries: {
      'webgpu.js': [
        "export * from './src/webgpu/WebGPUPathTracer.js';",
        "export * from './src/webgpu/BlurredEnvMapGenerator.js';",
        "export * from './src/webgpu/constants.js';",
        "export * from './src/webgpu/materials/RenderToScreenMaterial.js';",
        "export * from './src/objects/PhysicalCamera.js';",
        "export * from './src/objects/EquirectCamera.js';",
        "export * from './src/objects/PhysicalSpotLight.js';",
        "export * from './src/objects/ShapedAreaLight.js';",
        "import './src/webgpu/shims/EquirectCameraShim.js';",
        "import './src/webgpu/shims/PhysicalCameraShim.js';",
        "import './src/webgpu/shims/ArrayCameraShim.js';",
      ].join('\n'),
      // OIDN 降噪封装单独一个入口：模型权重由宿主下载后交给它，加载路径追踪器时不连带加载。
      'denoise.js': "export * from './src/webgpu/denoise/OIDNDenoiser.js';",
    },
  },
}

interface VendoredComponent { library: string; name: string; version: string; license: string; homepage: string; include: 'if-referenced' | 'embedded'; files: string[]; texts: string[] }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(root, 'resources', 'author-libs')
const stampFile = path.join(outputRoot, '.inputs.sha256')
const registryFile = path.join(root, 'src', 'core', 'videoEdit', 'codeMaterial', 'authorLibraries.ts')
const componentsDirectory = path.join(root, 'scripts', 'third-party-licenses', 'author-libs')
const components = (JSON.parse(fs.readFileSync(path.join(componentsDirectory, 'components.json'), 'utf8')) as { components: VendoredComponent[] }).components
const allowedLicenses = new Set<string>(AUTHOR_LIBRARY_LICENSES)

const log = (message: string): void => { process.stdout.write(`[author-libs] ${message}\n`) }
const posix = (value: string): string => value.split(path.sep).join('/')

/** 许可表达式里的每个许可都必须在白名单内（“MIT AND BSD-3-Clause”要两个都在）。 */
function assertAllowedLicense(owner: string, expression: string): void {
  const ids = expression.replace(/[()]/g, ' ').split(/\s+(?:AND|OR)\s+|\s+/).filter(Boolean)
  const rejected = ids.filter(id => !allowedLicenses.has(id))
  if (!ids.length || rejected.length) throw new Error(`${owner} 的许可 ${expression} 不在作者库许可白名单（${AUTHOR_LIBRARY_LICENSES.join('、')}）内`)
}

function packageDirectory(name: string): string {
  return path.join(root, 'node_modules', name)
}

function listFiles(directory: string, pattern: RegExp, skip: (relative: string) => boolean = () => false, base = directory): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink() || skip(posix(path.relative(base, file)))) return []
    return entry.isDirectory() ? listFiles(file, pattern, skip, base) : pattern.test(entry.name) ? [file] : []
  })
}

/** 生成入口在来源路径上的记号：不对应来源包里的文件。 */
const GENERATED = 'generated:'

/** 来源包内路径 → 版本目录内路径。白名单目录里的文件保持原相对位置。 */
function collectCandidates(plan: LibraryPlan, source: string, vendored: readonly string[]): Map<string, string> {
  const candidates = new Map<string, string>()
  for (const [target, from] of Object.entries(plan.files)) candidates.set(from, target)
  for (const target of Object.keys(plan.entries ?? {})) candidates.set(`${GENERATED}${target}`, target)
  for (const [base, names] of Object.entries(plan.directories ?? {})) {
    for (const name of names) {
      for (const file of listFiles(path.join(source, base, name), /\.m?js$/)) {
        const relative = posix(path.relative(source, file))
        candidates.set(relative, relative)
      }
    }
  }
  for (const file of vendored) candidates.set(file, file)
  return candidates
}

interface ModuleImport { start: number; end: number; specifier: string; dynamic: boolean }

function moduleImports(code: string): ModuleImport[] {
  const [imports] = parse(code)
  return imports.flatMap(entry => {
    if (entry.type === 'import-meta' || !entry.specifier) return []
    return [{ start: entry.start, end: entry.end, specifier: entry.specifier, dynamic: entry.type === 'dynamic' }]
  })
}

/** 已生成的各版本产物：版本目录前缀 `库名/版本/` → 目录内路径。库依赖据此确认被导入的文件确实随包。 */
const builtOutputs = new Map<string, Set<string>>()
const releasePrefix = (library: string, version: string): string => `${library}/${version}/`

/** 把库内导入改成版本目录内的相对路径；不能改写的说明符返回原因。 */
function linkModule(library: string, version: string, from: string, target: string, code: string, candidates: Map<string, string>): { code: string; dependencies: string[] } | { reason: string } {
  const dependencies: string[] = []
  const pinned = { ...AUTHOR_LIBRARIES[library][version].dependencies, [library]: version }
  let output = code
  for (const request of moduleImports(code).reverse()) {
    let dependency: string | undefined
    if (/^(?:https?:)?\/\//.test(request.specifier) || /^[a-z]+:/i.test(request.specifier)) return { reason: `导入外部地址 ${request.specifier}` }
    if (request.specifier.startsWith('.')) {
      dependency = path.posix.normalize(path.posix.join(path.posix.dirname(from), request.specifier))
    } else {
      const resolved = resolveAuthorLibraryModule(request.specifier, pinned)
      if (resolved && resolved.library !== library && Object.hasOwn(pinned, resolved.library)) {
        if (!builtOutputs.get(releasePrefix(resolved.library, resolved.version))?.has(resolved.path)) return { reason: `导入的 ${request.specifier} 不在 ${resolved.library}@${resolved.version} 的产物里` }
        const relative = path.posix.relative(path.posix.dirname(releasePrefix(library, version) + target), releasePrefix(resolved.library, resolved.version) + resolved.path)
        output = output.slice(0, request.start) + (request.dynamic ? JSON.stringify(relative) : relative) + output.slice(request.end)
        continue
      }
      if (!resolved || resolved.library !== library) return { reason: `导入未登记的模块 ${request.specifier}` }
      dependency = [...candidates].find(([, mapped]) => mapped === resolved.path)?.[0]
      if (!dependency) return { reason: `导入未生成的模块 ${request.specifier}` }
    }
    if (!candidates.has(dependency)) return { reason: `依赖 ${dependency} 未收入` }
    dependencies.push(dependency)
    let relative = path.posix.relative(path.posix.dirname(target), candidates.get(dependency)!)
    if (!relative.startsWith('.')) relative = `./${relative}`
    const replacement = request.dynamic ? JSON.stringify(relative) : relative
    output = output.slice(0, request.start) + replacement + output.slice(request.end)
  }
  return { code: output, dependencies }
}

/** 版权声明写在普通注释里的文件（如 EXRLoader 保留的 BSD 声明）原样分发，压缩会删掉它们。 */
function hasPlainCopyrightComment(code: string): boolean {
  for (const match of code.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
    const comment = match[0]
    if (/copyright/i.test(comment) && !/^\/\*!|@license|@preserve/.test(comment)) return true
  }
  return false
}

/** 检查器把这些文件挂到 `/node_modules/<mount>/`；`modules` 是实际随包的运行时模块，没随包的子路径按找不到模块报告。 */
function typePackage(library: string, version: string, release: AuthorLibraryRelease, modules: string[]): string {
  const types = release.types
  assertAllowedLicense(`${library}@${version} 的类型声明`, types.license)
  const files: Record<string, string> = {}
  if (types.source === 'package') {
    const name = authorLibraryTypesPackageName(library, version)
    const directory = packageDirectory(name)
    const manifestFile = path.join(directory, 'package.json')
    if (!fs.existsSync(manifestFile)) throw new Error(`缺少类型依赖 ${name}，请先 npm install`)
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { name?: string; license?: string }
    if (manifest.name !== types.mount) throw new Error(`${name} 实际是 ${manifest.name}，与登记的 ${types.mount} 不一致`)
    if (manifest.license !== types.license) throw new Error(`${name} 包内许可为 ${manifest.license}，与登记的 ${types.license} 不一致`)
    files['package.json'] = fs.readFileSync(manifestFile, 'utf8')
    files.LICENSE = fs.readFileSync(path.join(directory, 'LICENSE'), 'utf8')
    for (const file of listFiles(directory, /\.d\.ts$/, relative => relative === 'node_modules')) files[posix(path.relative(directory, file))] = fs.readFileSync(file, 'utf8')
  } else if (types.source === 'bundled') {
    const directory = packageDirectory(authorLibraryPackageName(library, version))
    files['package.json'] = fs.readFileSync(path.join(directory, 'package.json'), 'utf8')
    files.LICENSE = fs.readFileSync(path.join(directory, 'LICENSE'), 'utf8')
    for (const file of listFiles(directory, /\.d\.ts$/, relative => relative === 'node_modules')) files[posix(path.relative(directory, file))] = fs.readFileSync(file, 'utf8')
  } else if (types.source === 'file') {
    files['package.json'] = JSON.stringify({ name: types.mount, version, types: 'index.d.ts' })
    files['index.d.ts'] = fs.readFileSync(path.join(root, types.file), 'utf8')
  }
  return JSON.stringify({ mount: types.mount, modules, files })
}

function noticeText(key: string, present: VendoredComponent[]): string {
  const sections = present.map(component => [
    `${component.name} ${component.version}（${component.license}）${component.homepage}`,
    `文件：${component.files.join('、')}`,
    '',
    ...component.texts.map(text => fs.readFileSync(path.join(componentsDirectory, text), 'utf8').trim()),
  ].join('\n'))
  return `${key} 随库分发的第三方组件及其许可全文。\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`
}

async function buildRelease(library: string, version: string, destination: string): Promise<{ outputs: string[]; bytes: number; excluded: string[] }> {
  const key = `${library}@${version}`
  const release = AUTHOR_LIBRARIES[library][version]
  if (release.frozen) {
    const source = path.join(root, release.frozen)
    const manifest = readFrozenAuthorRelease(source, library, version)
    const written = [...Object.keys(manifest.outputs), 'release.json']
    for (const entry of [...Object.values(release.modules), AUTHOR_LIBRARY_TYPES_FILE, 'LICENSE']) if (!manifest.outputs[entry]) throw new Error(`${key} 冻结产物缺少 ${entry}`)
    fs.mkdirSync(destination, { recursive: true })
    let bytes = 0
    for (const file of written) {
      fs.mkdirSync(path.dirname(path.join(destination, file)), { recursive: true })
      fs.copyFileSync(path.join(source, file), path.join(destination, file))
      bytes += fs.statSync(path.join(source, file)).size
    }
    return { outputs: written.map(file => `${library}/${version}/${file}`), bytes, excluded: [] }
  }
  const plan = PLANS[key]
  if (!plan) throw new Error(`${key} 已登记但构建脚本没有拷贝计划`)
  assertAllowedLicense(key, release.license)
  const source = packageDirectory(authorLibraryPackageName(library, version))
  const manifestFile = path.join(source, 'package.json')
  if (!fs.existsSync(manifestFile)) throw new Error(`缺少依赖 ${authorLibraryPackageName(library, version)}，请先 npm install`)
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { name?: string; version?: string; license?: string }
  if (manifest.name !== library || manifest.version !== (plan.patched?.upstream ?? version)) throw new Error(`${authorLibraryPackageName(library, version)} 实际是 ${manifest.name}@${manifest.version}`)
  if (plan.patched && !fs.readFileSync(path.join(source, plan.patched.marker), 'utf8').includes('henji:')) throw new Error(`${key} 的补丁没有打上（${plan.patched.patch}），请重新 npm install`)
  if (manifest.license !== release.license) throw new Error(`${key} 包内许可为 ${manifest.license}，与登记的 ${release.license} 不一致`)
  const own = components.filter(component => component.library === key)
  for (const component of own) {
    assertAllowedLicense(`${key} 随库组件 ${component.name}`, component.license)
    for (const text of component.texts) if (!fs.existsSync(path.join(componentsDirectory, text))) throw new Error(`${key} 随库组件 ${component.name} 缺少许可全文 ${text}`)
  }
  // 随库文件不在白名单目录里，只有登记过许可的才可能收入。
  const vendored = own.filter(component => component.include === 'if-referenced').flatMap(component => component.files)

  const candidates = collectCandidates(plan, source, vendored)
  const linked = new Map<string, { code: string; dependencies: string[] }>()
  const excluded = new Map<string, string>()
  for (const [from, target] of candidates) {
    const file = path.join(source, from)
    const generated = from.startsWith(GENERATED) ? plan.entries?.[target] : undefined
    if (generated === undefined && !fs.existsSync(file)) { excluded.set(from, '来源文件不存在'); continue }
    // 生成入口里的相对路径按版本目录写，当作位于来源包同一位置的文件解析。
    const result = linkModule(library, version, generated === undefined ? from : target, target, generated ?? fs.readFileSync(file, 'utf8'), candidates)
    if ('reason' in result) excluded.set(from, result.reason)
    else linked.set(from, result)
  }
  // 依赖闭包里有被排除的文件时，引用它的文件也排除，直到稳定。
  for (let changed = true; changed;) {
    changed = false
    for (const [from, module] of linked) {
      const missing = module.dependencies.find(dependency => !linked.has(dependency))
      if (missing) { linked.delete(from); excluded.set(from, `依赖 ${missing} 未收入（${excluded.get(missing) ?? '未知原因'}）`); changed = true }
    }
  }
  for (const from of [...Object.values(plan.files), ...Object.keys(plan.entries ?? {}).map(target => `${GENERATED}${target}`)]) {
    if (!linked.has(from)) throw new Error(`${key} 的必需文件 ${from} 无法生成：${excluded.get(from)}`)
  }
  // 只因被引用才收入的随库文件，没有引用者时去掉。
  const referenced = new Set([...linked.values()].flatMap(module => module.dependencies))
  for (const file of vendored) if (!referenced.has(file)) linked.delete(file)

  let bytes = 0
  const outputs = new Set([...linked.keys()].map(from => candidates.get(from)!))
  for (const [from, module] of linked) {
    const target = candidates.get(from)!
    const code = hasPlainCopyrightComment(module.code)
      ? module.code
      : (await esbuild.transform(module.code, { loader: 'js', format: 'esm', target: 'esnext', minify: true, legalComments: 'inline', charset: 'utf8' })).code
    for (const request of moduleImports(code)) {
      // 按 author-lib 根目录解析：库依赖指向兄弟版本目录。
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(releasePrefix(library, version) + target), request.specifier))
      const own = releasePrefix(library, version)
      const loadable = request.specifier.startsWith('.') && (resolved.startsWith(own)
        ? outputs.has(resolved.slice(own.length))
        : [...builtOutputs].some(([prefix, files]) => resolved.startsWith(prefix) && files.has(resolved.slice(prefix.length))))
      if (!loadable) throw new Error(`${key} 产物 ${target} 残留无法加载的导入 ${request.specifier}`)
    }
    const file = path.join(destination, target)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, code)
    bytes += Buffer.byteLength(code)
  }
  for (const target of Object.values(release.modules)) {
    if (!outputs.has(target)) throw new Error(`${key} 登记的入口 ${target} 未生成`)
  }
  builtOutputs.set(releasePrefix(library, version), outputs)
  const written = [...outputs].sort()
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(destination, 'LICENSE'))
  written.push('LICENSE')
  const present = own.filter(component => component.files.some(file => outputs.has(file) || file === AUTHOR_LIBRARY_TYPES_FILE))
  if (present.length) { fs.writeFileSync(path.join(destination, 'NOTICE.txt'), noticeText(key, present)); written.push('NOTICE.txt') }
  const types = typePackage(library, version, release, [...outputs].sort())
  fs.writeFileSync(path.join(destination, AUTHOR_LIBRARY_TYPES_FILE), types)
  written.push(AUTHOR_LIBRARY_TYPES_FILE)
  bytes += Buffer.byteLength(types)
  return { outputs: written.map(file => `${library}/${version}/${file}`), bytes, excluded: [...excluded].filter(([from]) => !vendored.includes(from) || referenced.has(from)).map(([from, reason]) => `${from}：${reason}`) }
}

function inputsHash(): string {
  const hash = crypto.createHash('sha256')
  const add = (label: string, file: string): void => { hash.update(`${label}\n`); if (fs.existsSync(file)) hash.update(fs.readFileSync(file)) }
  add('script', fileURLToPath(import.meta.url))
  add('registry', registryFile)
  for (const name of fs.readdirSync(componentsDirectory).sort()) add(name, path.join(componentsDirectory, name))
  // 压缩与导入分析的结果随工具版本变化。
  for (const tool of ['esbuild-wasm', 'es-module-lexer']) add(tool, path.join(packageDirectory(tool), 'package.json'))
  for (const [library, releases] of Object.entries(AUTHOR_LIBRARIES)) {
    for (const [version, release] of Object.entries(releases)) {
      if (release.frozen) {
        const source = path.join(root, release.frozen)
        const manifest = readFrozenAuthorRelease(source, library, version)
        add(`${library}@${version} frozen`, path.join(source, 'release.json'))
        for (const file of Object.keys(manifest.outputs)) add(`${library}@${version}/${file}`, path.join(source, file))
        continue
      }
      add(`${library}@${version}`, path.join(packageDirectory(authorLibraryPackageName(library, version)), 'package.json'))
      const patched = PLANS[`${library}@${version}`]?.patched
      if (patched) add(`${library}@${version} patch`, path.join(root, patched.patch))
      if (release.types.source === 'package') add(`${library}@${version} types`, path.join(packageDirectory(authorLibraryTypesPackageName(library, version)), 'package.json'))
      else if (release.types.source === 'file') add(`${library}@${version} types`, path.join(root, release.types.file))
    }
  }
  return hash.digest('hex')
}

/** 指纹相同还要产物齐全：手动删掉或被清理掉的文件要重建，不能当作最新。 */
function upToDate(stamp: string): boolean {
  try {
    for (const [library, releases] of Object.entries(AUTHOR_LIBRARIES)) for (const [version, release] of Object.entries(releases)) {
      if (release.frozen) readFrozenAuthorRelease(path.join(outputRoot, library, version), library, version)
    }
    const recorded = JSON.parse(fs.readFileSync(stampFile, 'utf8')) as { hash?: string; files?: string[] }
    return recorded.hash === stamp && Array.isArray(recorded.files) && recorded.files.length > 0 && recorded.files.every(file => fs.statSync(path.join(outputRoot, file)).isFile())
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const unknown = process.argv.slice(2).filter(arg => arg !== '--force')
  if (unknown.length) throw new Error(`未知参数：${unknown.join(' ')}`)
  const stamp = inputsHash()
  if (!force && upToDate(stamp)) {
    log('输入未变化，复用现有产物')
    return
  }
  const staging = `${outputRoot}.tmp`
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    const files: string[] = []
    for (const [library, releases] of Object.entries(AUTHOR_LIBRARIES)) {
      for (const version of Object.keys(releases)) {
        const startedAt = Date.now()
        const result = await buildRelease(library, version, path.join(staging, library, version))
        files.push(...result.outputs)
        log(`${library}@${version}：${result.outputs.length} 个文件，${(result.bytes / 1024 / 1024).toFixed(2)} MB，${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
        for (const line of result.excluded) log(`  排除 ${line}`)
      }
    }
    fs.writeFileSync(path.join(staging, '.inputs.sha256'), `${JSON.stringify({ hash: stamp, files })}\n`)
    fs.rmSync(outputRoot, { recursive: true, force: true })
    // Windows 上杀毒与索引服务常短暂占用刚写入的文件，目录改名会 EPERM；复制不受影响。
    fs.cpSync(staging, outputRoot, { recursive: true })
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[author-libs] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
