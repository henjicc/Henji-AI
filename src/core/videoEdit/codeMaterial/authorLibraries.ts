/**
 * 代码效果可直接导入的内置第三方库：库名、版本、模块入口、类型与许可的唯一登记。
 *
 * 每个版本由 `scripts/build-author-libraries.ts` 从 npm 别名包 `henji-author-<库名>-<版本>` 生成到
 * `resources/author-libs/<库名>/<版本>/`，经 `henji-media://author-lib/` 只读提供。渲染 Worker 按 URL
 * 只求值一次模块，所以引用同一版本的多个效果共用一份库实例；旧版本随包保留，已有工程按记录的版本继续加载。
 *
 * 本文件不引入任何模块：主进程、渲染层与 Node 构建脚本都直接读取它。
 */

/** 只收这些宽松许可；LGPL/GPL 等不进作者库。 */
export const AUTHOR_LIBRARY_LICENSES = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'Unlicense'] as const
export type AuthorLibraryLicense = typeof AUTHOR_LIBRARY_LICENSES[number]

export interface AuthorLibraryRelease {
  license: AuthorLibraryLicense
  /** 完整说明符 → 版本目录内的模块路径。 */
  modules: Readonly<Record<string, string>>
  /** 说明符前缀 → 版本目录内的目录；前缀之后的子路径原样拼接。 */
  directories?: Readonly<Record<string, string>>
  /**
   * 作者类型检查用的声明，构建时打成版本目录里的 `types.json`，检查时挂到内存里的 `/node_modules/<mount>/`。
   * `package`：来自 npm 别名包 `henji-author-<库名>-types-<版本>`；`file`：仓库内手写的声明（上游没有对得上的类型包时）。
   */
  types: { mount: string; license: AuthorLibraryLicense; source: 'package' } | { mount: string; license: AuthorLibraryLicense; source: 'file'; file: string }
}

export const AUTHOR_LIBRARY_HOST = 'author-lib'
export const AUTHOR_LIBRARY_TYPES_FILE = 'types.json'

/** 每个库的第一个版本是“第一套”：没有记录 libraries 的代码版本一直按它运行，所以只能追加新版本，不能改动已有版本。 */
export const AUTHOR_LIBRARIES: Readonly<Record<string, Readonly<Record<string, AuthorLibraryRelease>>>> = {
  three: {
    '0.186.1': {
      license: 'MIT',
      // three.module.js 与 three.webgpu.js 都从 three.core.js 取核心类，混用两个入口时类仍是同一份。
      modules: {
        three: 'build/three.module.js',
        'three/webgpu': 'build/three.webgpu.js',
        'three/tsl': 'build/three.tsl.js',
      },
      directories: {
        'three/addons/': 'examples/jsm/',
        'three/examples/jsm/': 'examples/jsm/',
      },
      types: { mount: '@types/three', license: 'MIT', source: 'package' },
    },
  },
  'opentype.js': {
    // @types/opentype.js 只到 1.3.x：2.0 去掉了默认导出，load/loadSync 只剩弃用提示，所以用手写的 2.0 声明。
    '2.0.0': { license: 'MIT', modules: { 'opentype.js': 'opentype.mjs' }, types: { mount: 'opentype.js', license: 'MIT', source: 'file', file: 'resources/video-edit-author/libraries/opentype.js-2.0.0.d.ts' } },
  },
}

/** 库名 → 版本。 */
export type AuthorLibraryVersions = Readonly<Record<string, string>>

/** 新写的代码版本用这张表；表里改版本不影响已有记录。 */
export const DEFAULT_AUTHOR_LIBRARY_VERSIONS: AuthorLibraryVersions = {
  three: '0.186.1',
  'opentype.js': '2.0.0',
}

export interface ResolvedAuthorLibraryModule {
  library: string
  version: string
  /** 版本目录内的相对路径。 */
  path: string
  url: string
}

export function authorLibraryPackageName(library: string, version: string): string {
  return `henji-author-${library}-${version}`
}

export function authorLibraryTypesPackageName(library: string, version: string): string {
  return `henji-author-${library}-types-${version}`
}

export function authorLibraryUrl(library: string, version: string, path: string): string {
  return `henji-media://${AUTHOR_LIBRARY_HOST}/${library}/${version}/${path}`
}

/** 说明符的库名部分：`three/addons/x.js` → `three`，`@scope/pkg/x` → `@scope/pkg`。 */
function libraryNameOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** 代码版本记录了的库用记录的版本，没有记录的用第一套。 */
export function authorLibraryVersion(library: string, versions?: AuthorLibraryVersions): string | undefined {
  if (!Object.hasOwn(AUTHOR_LIBRARIES, library)) return undefined
  return versions && Object.hasOwn(versions, library) ? versions[library] : Object.keys(AUTHOR_LIBRARIES[library])[0]
}

/** 只解析已登记的库与版本；未登记的说明符返回 undefined，交给调用方按“找不到模块”报错。 */
export function resolveAuthorLibraryModule(specifier: string, versions?: AuthorLibraryVersions): ResolvedAuthorLibraryModule | undefined {
  const library = libraryNameOf(specifier)
  const version = authorLibraryVersion(library, versions)
  const release = version && Object.hasOwn(AUTHOR_LIBRARIES[library], version) ? AUTHOR_LIBRARIES[library][version] : undefined
  if (!version || !release) return undefined
  let path = Object.hasOwn(release.modules, specifier) ? release.modules[specifier] : undefined
  if (!path) {
    for (const [prefix, directory] of Object.entries(release.directories ?? {})) {
      const rest = specifier.slice(prefix.length)
      // 子路径只能落在登记目录内，不允许借 `..` 跳到版本目录的其他位置。
      if (specifier.startsWith(prefix) && rest && !rest.split('/').some(part => part === '..' || part === '.' || part === '')) {
        path = directory + rest
        break
      }
    }
  }
  return path ? { library, version, path, url: authorLibraryUrl(library, version, path) } : undefined
}

/** 说明符只在运行时才知道的动态 import 用这张表查找，规则与 `resolveAuthorLibraryModule` 相同。 */
export function authorLibraryImportTable(versions?: AuthorLibraryVersions): { modules: Record<string, string>; directories: Array<[string, string]> } {
  const modules: Record<string, string> = {}
  const directories: Array<[string, string]> = []
  for (const library of Object.keys(AUTHOR_LIBRARIES)) {
    const version = authorLibraryVersion(library, versions)
    const release = version ? AUTHOR_LIBRARIES[library][version] : undefined
    if (!version || !release) continue
    for (const [specifier, path] of Object.entries(release.modules)) modules[specifier] = authorLibraryUrl(library, version, path)
    for (const [prefix, directory] of Object.entries(release.directories ?? {})) directories.push([prefix, authorLibraryUrl(library, version, directory)])
  }
  return { modules, directories }
}

/** 错误信息里列出可用的内置库，作者据此改写导入。 */
export function describeAuthorLibraries(versions?: AuthorLibraryVersions): string {
  return Object.keys(AUTHOR_LIBRARIES).map(library => {
    const version = authorLibraryVersion(library, versions)
    const release = version ? AUTHOR_LIBRARIES[library][version] : undefined
    if (!release) return library
    const specifiers = [...Object.keys(release.modules), ...Object.keys(release.directories ?? {}).map(prefix => `${prefix}*`)]
    return `${library}@${version}（${specifiers.join('、')}）`
  }).join('；')
}
