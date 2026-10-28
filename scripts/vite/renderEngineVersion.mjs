import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * 用 Vite 自带的 esbuild：仓库没有把 esbuild 列为直接依赖，单独固定版本会让 npm 重新整理依赖树。
 * 它的版本参与散列，Vite 升级换了 esbuild 时引擎版本随之改变。
 */
const require = createRequire(import.meta.url)
const esbuild = createRequire(require.resolve('vite'))('esbuild')

/**
 * 剪辑预渲染的“渲染引擎版本”：把决定预览文件内容的源码连同依赖包版本、esbuild 版本散列成一个短串，
 * 由虚拟模块交给 `src/core/videoEdit/renderCache.ts` 计入窗口指纹。引擎实现一变，旧预览文件全部失效。
 *
 * 散列的是 esbuild 打包并去掉注释与空白后的产物：只改注释、空白或类型不会让缓存失效，
 * 而闭包里任何一处运行逻辑变化（包括目录外被引用到的文件）都会。
 */
export const VIDEO_EDIT_RENDER_ENGINE_MODULE = 'virtual:video-edit-render-engine'
const MODULE_ID = VIDEO_EDIT_RENDER_ENGINE_MODULE
const RESOLVED_ID = `\0${MODULE_ID}`

/**
 * 沿依赖闭包散列的入口：合成画面的渲染 Worker、窗口切分与指纹、预渲染编码参数，以及作者代码的编译 Worker
 * （渲染 Worker 用 `new URL()` 启动它，esbuild 不会沿这种写法跟进，所以单列）。
 * 主线程的预渲染调度与会话代理只散列文件本身：它们经剪辑服务引到整个应用（约 1400 个文件），
 * 沿闭包散列会让任何界面改动都使整片预渲染失效；画面本身由 Worker 闭包决定。
 */
export const RENDER_ENGINE_CLOSURES = [
  'src/features/videoEdit/engine/videoEditWorker.ts',
  'src/features/videoEdit/engine/videoEditCodeCompiler.worker.ts',
  'src/core/videoEdit/renderCache.ts',
  'src/core/videoEdit/renderBitrate.ts',
  'src/features/videoEdit/engine/videoEditExportEncoder.ts',
]
/**
 * 闭包边界：闭包里的文件引用到这些模块时只记引用路径，不再往里走。它们的实现与画面无关——
 * 日志与平台桥接（经 platform/runtime 引到全部 IPC 适配器）、持久格式的登记表、错误文案与向前兼容读取、助手记忆、
 * 应用控制标识、界面文案、创作意图记录、文档信封；不设边界时改任一 IPC 适配器、日志或错误文案都会让所有用户的预渲染作废。
 * 持久化的迁移实现（migrations、formatMigrations）留在闭包里：渲染时展开代码组件会就地迁移组件说明。
 */
export const RENDER_ENGINE_BOUNDARIES = [
  'src/core/logging',
  'src/platform/runtime',
  'src/core/persistence/formats',
  'src/core/persistence/messages',
  'src/core/persistence/forwardCompat',
  'src/core/assistant',
  'src/core/application-control',
  'src/i18n',
  'src/core/creativeIntent',
  'src/core/documents',
]
export const RENDER_ENGINE_FILES = [
  'src/features/videoEdit/application/videoEditRenderCache.ts',
  'src/features/videoEdit/engine/videoEditRenderSession.ts',
  'src/features/videoEdit/engine/videoEditRenderTransport.ts',
]

/**
 * 按 Vite 的 `?raw` 把文件当文本读（WGSL 着色器、作者接口的类型声明等）。
 * WGSL 没有字符串字面量，按行注释、块注释与空白归一化是安全的；其他文本原样计入。
 */
const rawTextPlugin = {
  name: 'render-engine-raw-text',
  setup(build) {
    build.onLoad({ filter: /.*/ }, async args => {
      const wgsl = args.path.endsWith('.wgsl')
      if (!wgsl && args.suffix !== '?raw') return undefined
      const source = await fs.promises.readFile(args.path, 'utf8')
      return { contents: wgsl ? source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ').trim() : source, loader: 'text' }
    })
  },
}
function boundaryPlugin(root, boundaries) {
  return {
    name: 'render-engine-boundary',
    setup(build) {
      build.onResolve({ filter: /^(?:@\/|\.)/ }, args => {
        const target = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : path.resolve(args.resolveDir, args.path)
        const relative = slash(path.relative(root, target.split('?')[0])).replace(/\.(?:[cm]?[jt]sx?|json)$/, '')
        return boundaries.some(boundary => relative === boundary || relative.startsWith(`${boundary}/`)) ? { path: args.path, external: true } : undefined
      })
    },
  }
}
/** 只取入口文件本身：它的所有导入都留作外部引用，引用路径本身仍计入散列。 */
const ownFilePlugin = {
  name: 'render-engine-own-file',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' ? undefined : { path: args.path, external: true })
  },
}

const slash = value => value.replace(/\\/g, '/')
/** Windows 上 Vite 与 esbuild 给出的盘符大小写可能不同。 */
const fileKey = file => { const value = slash(path.resolve(file)); return process.platform === 'win32' ? value.toLowerCase() : value }
const packageName = specifier => {
  const bare = specifier.split('?')[0]
  if (/^(?:\.|\/|@\/|virtual:|node:)/.test(bare) || /^[a-zA-Z]:/.test(bare)) return undefined
  const parts = bare.split('/')
  return bare.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}
function packageVersion(root, name) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version ?? 'unknown' } catch { return 'missing' }
}

/**
 * 求 `closures`（沿依赖闭包，到 `boundaries` 为止）与 `files`（只取文件本身）的引擎版本，并返回参与散列的源文件
 * （开发版据此判断哪些改动要重算）。依赖包不进闭包，以名称和已安装版本参与散列。
 */
export async function computeRenderEngineVersion({ root, closures = RENDER_ENGINE_CLOSURES, files = RENDER_ENGINE_FILES, boundaries = RENDER_ENGINE_BOUNDARIES }) {
  const common = {
    absWorkingDir: root, bundle: true, write: false, outdir: 'render-engine', format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent',
    minifyWhitespace: true, legalComments: 'none', charset: 'utf8', alias: { '@': path.join(root, 'src') }, external: ['virtual:*'],
  }
  const builds = await Promise.all([
    closures.length ? esbuild.build({ ...common, entryPoints: [...closures], packages: 'external', plugins: [boundaryPlugin(root, boundaries), rawTextPlugin] }) : undefined,
    files.length ? esbuild.build({ ...common, entryPoints: [...files], outdir: 'render-engine-files', plugins: [ownFilePlugin] }) : undefined,
  ])
  const outputs = [], sources = new Set(), packages = new Map()
  for (const result of builds) {
    if (!result) continue
    for (const file of result.outputFiles) outputs.push([slash(path.relative(root, file.path)), file.text])
    for (const [input, value] of Object.entries(result.metafile.inputs)) {
      sources.add(path.resolve(root, input.split('?')[0]))
      for (const item of value.imports) {
        const name = item.external ? packageName(item.path) : undefined
        if (name && !packages.has(name)) packages.set(name, packageVersion(root, name))
      }
    }
  }
  outputs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  const digest = createHash('sha256').update(JSON.stringify({ esbuild: esbuild.version, packages: [...packages].sort(), outputs })).digest('hex')
  return { version: digest.slice(0, 16), files: [...sources].sort() }
}

/**
 * Vite 插件：提供 `virtual:video-edit-render-engine`。构建时算一次；开发版改到参与散列的文件就重算，
 * 版本变了让引用它的模块失效并整页重新加载（指纹必须和正在运行的引擎一致）。`fixed` 给单元测试用固定值。
 */
export function videoEditRenderEngineVersion(options = {}) {
  const { fixed } = options
  let root = options.root
  let pending
  let watched = new Set()
  const compute = () => {
    const current = computeRenderEngineVersion({ root, closures: options.closures, files: options.files, boundaries: options.boundaries }).then(result => {
      if (pending === current) watched = new Set(result.files.map(fileKey))
      return result.version
    })
    pending = current
    // 失败（例如正在编辑的文件暂时有语法错误）时下次读取重算；读取方仍会收到这次的错误。
    current.catch(() => { if (pending === current) pending = undefined })
    return current
  }
  return {
    name: 'henji:video-edit-render-engine-version',
    configResolved(config) { root ??= config.root },
    buildStart() { if (fixed === undefined && !pending) compute() },
    resolveId(id) { return id === MODULE_ID ? RESOLVED_ID : undefined },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined
      const version = fixed ?? await (pending ?? compute())
      return `export const VIDEO_EDIT_RENDER_ENGINE_VERSION = ${JSON.stringify(version)}\n`
    },
    async handleHotUpdate({ file, server }) {
      if (fixed !== undefined || !watched.has(fileKey(file))) return undefined
      const previous = await (pending ?? Promise.resolve(undefined)).catch(() => undefined)
      const next = await compute().catch(() => undefined)
      if (next === undefined || next === previous) return undefined
      const module = server.moduleGraph.getModuleById(RESOLVED_ID)
      if (module) server.moduleGraph.invalidateModule(module)
      server.ws.send({ type: 'full-reload' })
      return []
    },
  }
}
