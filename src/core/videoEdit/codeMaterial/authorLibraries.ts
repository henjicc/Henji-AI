/**
 * 代码效果可直接导入的内置库：库名、版本、模块入口、类型与许可的唯一登记。
 *
 * 第三方库由 `scripts/build-author-libraries.ts` 从 npm 别名包 `henji-author-<库名>-<版本>` 生成，自家库从冻结产物复制到
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
  minApiVersion: number
  /** 自家库只从已冻结且带摘要的产物发行，不在日常构建中读取最新源码。 */
  frozen?: string
  /** 完整说明符 → 版本目录内的模块路径。 */
  modules: Readonly<Record<string, string>>
  /** 说明符前缀 → 版本目录内的目录；前缀之后的子路径原样拼接。 */
  directories?: Readonly<Record<string, string>>
  /**
   * 库内导入的其他内置库（库名 → 版本）：构建时改成指向那一版目录的相对路径，运行时与作者自己导入的同一版共用一份实例。
   * 作者代码记录的这些库必须是同一版，否则会出现两份 three，类与材质互不认识。
   */
  dependencies?: Readonly<Record<string, string>>
  /**
   * 作者类型检查用的声明，构建时打成版本目录里的 `types.json`，检查时挂到内存里的 `/node_modules/<mount>/`。
   * `package`：npm 别名类型包；`bundled`：库自带的声明；`file`：上游无对应声明时的仓库声明；`frozen`：随不可变版本保存的权威类型生成结果。
   */
  types: { mount: string; license: AuthorLibraryLicense; source: 'package' | 'bundled' | 'frozen' } | { mount: string; license: AuthorLibraryLicense; source: 'file'; file: string }
}


export const AUTHOR_LIBRARY_HOST = 'author-lib'
export const AUTHOR_LIBRARY_TYPES_FILE = 'types.json'

/** 每个库的第一个版本是“第一套”：没有记录 libraries 的代码版本一直按它运行，所以只能追加新版本，不能改动已有版本。 */
export const AUTHOR_LIBRARIES: Readonly<Record<string, Readonly<Record<string, AuthorLibraryRelease>>>> = {
  '@dimforge/rapier3d-deterministic-compat': {
    // 构建脚本用原生 Node 直接加载本登记，这里不能有导入：13 即作者接口里模拟起始的版本（CODE_AUTHOR_SIMULATION_MIN_API_VERSION）。
    '0.21.0-henji.1': { license: 'Apache-2.0', minApiVersion: 13, frozen: 'resources/video-edit-author/frozen/@dimforge/rapier3d-deterministic-compat/0.21.0-henji.1', modules: { '@dimforge/rapier3d-deterministic-compat': 'rapier.mjs' }, types: { mount: '@dimforge/rapier3d-deterministic-compat', license: 'Apache-2.0', source: 'frozen' } },
  },
  'henji-effects': {
    '1.0.0': { license: 'Apache-2.0', minApiVersion: 7, frozen: 'resources/video-edit-author/frozen/henji-effects/1.0.0', modules: { 'henji-effects': 'index.mjs' }, types: { mount: 'henji-effects', license: 'Apache-2.0', source: 'frozen' } },
    // 1.1.0：模糊合成一个效果（blur 的 mode 选均匀、方向、放射、镜头），锐化补半径与阈值，参数带常用范围。
    '1.1.0': { license: 'Apache-2.0', minApiVersion: 7, frozen: 'resources/video-edit-author/frozen/henji-effects/1.1.0', modules: { 'henji-effects': 'index.mjs' }, types: { mount: 'henji-effects', license: 'Apache-2.0', source: 'frozen' } },
    '1.2.0': { license: 'Apache-2.0', minApiVersion: 7, frozen: 'resources/video-edit-author/frozen/henji-effects/1.2.0', modules: { 'henji-effects': 'index.mjs' }, types: { mount: 'henji-effects', license: 'Apache-2.0', source: 'frozen' } },
    // 1.3.0：新增投影 shadow、描边 stroke、扫光 lightSweep、溶解显影 dissolve 工厂，发光多“轮廓”方式（mode: 'shape'）。
    '1.3.0': { license: 'Apache-2.0', minApiVersion: 7, frozen: 'resources/video-edit-author/frozen/henji-effects/1.3.0', modules: { 'henji-effects': 'index.mjs' }, types: { mount: 'henji-effects', license: 'Apache-2.0', source: 'frozen' } },
    // 1.4.0：效果库第二批全部工厂——渐变 gradient（也可作图层 fill）、渐变映射、色调分离、反相、半调、抖动点阵、纸张、划痕、故障、镜像、重复阵列、
    // 膨胀、旋转扭曲、波动、边角定位、置换、暗角、颗粒、镜头光晕、漏光，以及效果的 key 选项（点选元素时保持稳定身份）。
    '1.4.0': { license: 'Apache-2.0', minApiVersion: 7, frozen: 'resources/video-edit-author/frozen/henji-effects/1.4.0', modules: { 'henji-effects': 'index.mjs' }, types: { mount: 'henji-effects', license: 'Apache-2.0', source: 'frozen' } },
  },
  three: {
    '0.186.1': {
      license: 'MIT',
      minApiVersion: 5,
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
  // 网格加速结构与路径追踪：只收 WebGPU 路径追踪器需要的部分与 OIDN 降噪封装（权重由宿主下载）；超分要从网络加载 wasm，不随包。
  'three-mesh-bvh': {
    '0.9.17': {
      license: 'MIT', minApiVersion: 15,
      modules: { 'three-mesh-bvh': 'src/index.js', 'three-mesh-bvh/webgpu': 'src/webgpu/index.js' },
      dependencies: { three: '0.186.1' },
      types: { mount: 'three-mesh-bvh', license: 'MIT', source: 'bundled' },
    },
  },
  'three-gpu-pathtracer': {
    '0.0.27': {
      license: 'MIT', minApiVersion: 15,
      modules: { 'three-gpu-pathtracer/webgpu': 'webgpu.js', 'three-gpu-pathtracer/denoise': 'denoise.js' },
      dependencies: { three: '0.186.1', 'three-mesh-bvh': '0.9.17' },
      types: { mount: 'three-gpu-pathtracer', license: 'MIT', source: 'bundled' },
    },
    // 宿主路径追踪用的补丁版：材质贴图图集改半精度，matte 判断移到半透明随机穿透之后（见 scripts/build-author-libraries.ts）。
    '0.0.27-henji.1': {
      license: 'MIT', minApiVersion: 15,
      modules: { 'three-gpu-pathtracer/webgpu': 'webgpu.js', 'three-gpu-pathtracer/denoise': 'denoise.js' },
      dependencies: { three: '0.186.1', 'three-mesh-bvh': '0.9.17' },
      types: { mount: 'three-gpu-pathtracer', license: 'MIT', source: 'bundled' },
    },
  },
  'opentype.js': {
    // @types/opentype.js 只到 1.3.x：2.0 去掉了默认导出，load/loadSync 只剩弃用提示，所以用手写的 2.0 声明。
    '2.0.0': { license: 'MIT', minApiVersion: 5, modules: { 'opentype.js': 'opentype.mjs' }, types: { mount: 'opentype.js', license: 'MIT', source: 'file', file: 'resources/video-edit-author/libraries/opentype.js-2.0.0.d.ts' } },
  },
  'henji-layout': {
    '1.0.0': {
      license: 'Apache-2.0', minApiVersion: 6,
      frozen: 'resources/video-edit-author/frozen/henji-layout/1.0.0',
      modules: { 'henji-layout/text': 'text.mjs', 'henji-layout/flex': 'flex.mjs' },
      types: { mount: 'henji-layout', license: 'Apache-2.0', source: 'frozen' },
    },
    '1.1.0': {
      license: 'Apache-2.0', minApiVersion: 6,
      frozen: 'resources/video-edit-author/frozen/henji-layout/1.1.0',
      modules: { 'henji-layout/text': 'text.mjs', 'henji-layout/flex': 'flex.mjs' },
      types: { mount: 'henji-layout', license: 'Apache-2.0', source: 'frozen' },
    },
    '1.2.0': {
      license: 'Apache-2.0', minApiVersion: 6,
      frozen: 'resources/video-edit-author/frozen/henji-layout/1.2.0',
      modules: { 'henji-layout/text': 'text.mjs', 'henji-layout/flex': 'flex.mjs' },
      types: { mount: 'henji-layout', license: 'Apache-2.0', source: 'frozen' },
    },
    '2.0.0': {
      license: 'Apache-2.0', minApiVersion: 10,
      frozen: 'resources/video-edit-author/frozen/henji-layout/2.0.0',
      modules: { 'henji-layout/text': 'text.mjs', 'henji-layout/flex': 'flex.mjs', 'henji-layout/table': 'table.mjs' },
      types: { mount: 'henji-layout', license: 'Apache-2.0', source: 'frozen' },
    },
    '2.0.1': {
      license: 'Apache-2.0', minApiVersion: 10,
      frozen: 'resources/video-edit-author/frozen/henji-layout/2.0.1',
      modules: { 'henji-layout/text': 'text.mjs', 'henji-layout/flex': 'flex.mjs', 'henji-layout/table': 'table.mjs' },
      types: { mount: 'henji-layout', license: 'Apache-2.0', source: 'frozen' },
    },
  },
}

/** 库名 → 版本。 */
export type AuthorLibraryVersions = Readonly<Record<string, string>>

/**
 * 只用于新版本编译；读取无 libraries 的历史版本仍走第一套。
 * 先给不依赖其他库的库选兼容的最新版，再反复给依赖都已选定的库选“依赖与已选版本一致”的最新版，直到不再变化；
 * 没有一致版本的库不提供（作者导入时报找不到，而不是加载出第二份 three）。
 */
export function latestAuthorLibraryVersions(apiVersion: number): AuthorLibraryVersions {
  const compatible = (name: string): string[] => Object.keys(AUTHOR_LIBRARIES[name]).filter(version => AUTHOR_LIBRARIES[name][version].minApiVersion <= apiVersion)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const chosen: Record<string, string> = {}
  for (const name of Object.keys(AUTHOR_LIBRARIES)) {
    const latest = compatible(name).filter(version => !AUTHOR_LIBRARIES[name][version].dependencies).at(-1)
    if (latest && compatible(name).every(version => !AUTHOR_LIBRARIES[name][version].dependencies)) chosen[name] = latest
  }
  for (let changed = true; changed;) {
    changed = false
    for (const name of Object.keys(AUTHOR_LIBRARIES)) {
      if (Object.hasOwn(chosen, name)) continue
      const consistent = compatible(name).filter(version => Object.entries(AUTHOR_LIBRARIES[name][version].dependencies ?? {})
        .every(([dependency, pinned]) => chosen[dependency] === pinned))
      if (consistent.length) { chosen[name] = consistent.at(-1)!; changed = true }
    }
  }
  return chosen
}

/** 作者代码记录的版本与某个库的库依赖不一致时的说明；一致返回 undefined。 */
export function authorLibraryDependencyError(library: string, version: string, versions?: AuthorLibraryVersions): string | undefined {
  for (const [dependency, pinned] of Object.entries(AUTHOR_LIBRARIES[library]?.[version]?.dependencies ?? {})) {
    const used = authorLibraryVersion(dependency, versions)
    if (used !== pinned) return `内置库 ${library}@${version} 需要 ${dependency}@${pinned}，这一版代码记录的是 ${dependency}@${used}。请把源码另存为新版本，让内置库版本重新对齐。`
  }
  return undefined
}

/** 未知版本由模块解析报错；已知版本的最低接口要求在所有导入路径共用。 */
export function authorLibraryCompatibilityError(library: string, version: string, apiVersion = 4): string | undefined {
  const release = AUTHOR_LIBRARIES[library]?.[version]
  return release && apiVersion < release.minApiVersion
    ? `内置库 ${library}@${version} 从作者接口 v${release.minApiVersion} 起可用，这一版按作者接口 v${apiVersion} 编译。请把源码另存为使用作者接口 v${release.minApiVersion} 的新版本，或移除此库导入；旧版本保持原样。`
    : undefined
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
export function authorLibraryImportTable(versions?: AuthorLibraryVersions, apiVersion = 4): { modules: Record<string, string>; directories: Array<[string, string]> } {
  const modules: Record<string, string> = {}
  const directories: Array<[string, string]> = []
  for (const library of Object.keys(AUTHOR_LIBRARIES)) {
    const version = authorLibraryVersion(library, versions)
    const release = version ? AUTHOR_LIBRARIES[library][version] : undefined
    if (!version || !release || authorLibraryCompatibilityError(library, version, apiVersion) || authorLibraryDependencyError(library, version, versions)) continue
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
    return `${library}@${version}（${specifiers.join('、')}）（作者接口 v${release.minApiVersion}+）`
  }).join('；')
}
