/**
 * 第三方开源许可清单（渲染层读取）。
 *
 * 数据由 `scripts/generate-third-party-licenses.cjs` 在构建时生成到 `resources/licenses/`，
 * 安装包随附的 THIRD-PARTY-NOTICES.txt 由同一份数据渲染，界面与安装包不会各维护一份。
 * 这里用 `import.meta.glob` 惰性加载：只有打开“关于”时才加载这块数据；文件缺失（例如开发时
 * 没跑生成脚本）时 glob 为空，界面给出不可用状态而不是让构建失败。
 */
import { createLogger } from '@/core/logging'

const logger = createLogger('components.Settings.about.thirdPartyLicenses')

export type ThirdPartyEcosystem = 'runtime' | 'npm' | 'cargo'
/** package：组件自带许可文件；standard：组件未附带，回退为该许可的标准文本；none：无全文 */
export type ThirdPartyTextOrigin = 'package' | 'standard' | 'none'

export interface ThirdPartyComponent {
  id: string
  name: string
  version: string | null
  license: string | null
  ecosystem: ThirdPartyEcosystem
  homepage: string | null
  textIds: string[]
  textOrigin: ThirdPartyTextOrigin
  /** GPL/LGPL/MPL 等组件的对应源码获取地址 */
  sources?: string[]
  /** 二进制内包含的外部库（如 FFmpeg 启用的编解码库） */
  includes?: string[]
  /** 许可全文在安装目录中的文件名（Chromium、Node.js 随 Electron 分发的汇总许可） */
  licenseFileHint?: string
}

export interface ThirdPartyNotices {
  project: { name: string; version: string; license: string; licenseTextId: string }
  highlights: string[]
  components: ThirdPartyComponent[]
  texts: Record<string, string>
}

type NoticesLoader = () => Promise<unknown>

const GENERATED_NOTICES = import.meta.glob<unknown>('/resources/licenses/third-party-licenses.json', { import: 'default' })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function parseComponent(value: unknown): ThirdPartyComponent | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null
  const ecosystem = value.ecosystem === 'runtime' || value.ecosystem === 'cargo' ? value.ecosystem : 'npm'
  const textOrigin = value.textOrigin === 'standard' || value.textOrigin === 'none' ? value.textOrigin : 'package'
  const component: ThirdPartyComponent = {
    id: value.id,
    name: value.name,
    version: optionalString(value.version),
    license: optionalString(value.license),
    ecosystem,
    homepage: optionalString(value.homepage),
    textIds: stringList(value.textIds) ?? [],
    textOrigin,
  }
  const sources = stringList(value.sources)
  if (sources?.length) component.sources = sources
  const includes = stringList(value.includes)
  if (includes?.length) component.includes = includes
  const licenseFileHint = optionalString(value.licenseFileHint)
  if (licenseFileHint) component.licenseFileHint = licenseFileHint
  return component
}

/** 校验生成产物结构；格式不符时抛错，由调用方展示不可用状态。 */
export function parseThirdPartyNotices(value: unknown): ThirdPartyNotices {
  if (!isRecord(value) || !isRecord(value.project) || !Array.isArray(value.components) || !isRecord(value.texts)) {
    throw new Error('第三方许可清单格式无效')
  }
  const project = value.project
  if (typeof project.license !== 'string' || typeof project.licenseTextId !== 'string') {
    throw new Error('第三方许可清单缺少项目许可')
  }
  const texts: Record<string, string> = {}
  for (const [id, text] of Object.entries(value.texts)) {
    if (typeof text === 'string') texts[id] = text
  }
  return {
    project: {
      name: typeof project.name === 'string' ? project.name : '',
      version: typeof project.version === 'string' ? project.version : '',
      license: project.license,
      licenseTextId: project.licenseTextId,
    },
    highlights: stringList(value.highlights) ?? [],
    components: value.components.map(parseComponent).filter((item): item is ThirdPartyComponent => item !== null),
    texts,
  }
}

let cached: Promise<ThirdPartyNotices> | null = null

/** 读取清单（进程内只加载一次）。`loaders` 仅供测试注入。 */
export function loadThirdPartyNotices(loaders: Record<string, NoticesLoader> = GENERATED_NOTICES): Promise<ThirdPartyNotices> {
  if (cached && loaders === GENERATED_NOTICES) return cached
  const load = Object.values(loaders)[0]
  const pending = (async () => {
    if (!load) throw new Error('未找到第三方许可清单（resources/licenses/third-party-licenses.json），请运行 npm run gen:licenses')
    return parseThirdPartyNotices(await load())
  })()
  if (loaders !== GENERATED_NOTICES) return pending
  cached = pending.catch((error: unknown) => {
    cached = null
    logger.warn('settings.about.third_party_notices.load_failed', { error: error instanceof Error ? error.message : String(error) })
    throw error
  })
  return cached
}

/** 按名称、版本、许可证过滤（不区分大小写）。 */
export function filterThirdPartyComponents(components: readonly ThirdPartyComponent[], keyword: string): ThirdPartyComponent[] {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return [...components]
  return components.filter((component) => (
    component.name.toLowerCase().includes(normalized)
    || (component.version ?? '').toLowerCase().includes(normalized)
    || (component.license ?? '').toLowerCase().includes(normalized)
  ))
}
