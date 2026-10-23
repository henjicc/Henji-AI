import { SETTINGS_DECLARATION, type SettingsSectionDeclaration, type SettingsTabDeclaration } from './settingsDeclaration'

export type SettingsTabId = keyof typeof SETTINGS_DECLARATION
export type SettingsSectionId = (typeof SETTINGS_DECLARATION)[SettingsTabId]['sections'][number]['id']
export type SettingsComponentKey = (typeof SETTINGS_DECLARATION)[SettingsTabId]['sections'][number]['componentKeys'][number]

/** 打开设置面板时的定位目标；省略则回到默认分节 */
export interface SettingsNavigationTarget {
  tab: SettingsTabId
  sectionId?: SettingsSectionId
}

type Declaration = Readonly<Record<string, SettingsTabDeclaration>>
type DeclaredTab<T extends Declaration> = keyof T & string
type DeclaredSection<T extends Declaration> = T[DeclaredTab<T>]['sections'][number]
type ParentSurface<D> = D extends { readonly surface: { readonly id: infer S extends string } } ? S : never
type DeclaredSurface<T extends Declaration> = DeclaredSection<T>['surfaceId'] | ParentSurface<T[DeclaredTab<T>]>

export interface SettingsRegistration<T extends Declaration> {
  tabs: DeclaredTab<T>[]
  tabSections: { [K in DeclaredTab<T>]: T[K]['sections'][number]['id'][] }
  sections: (SettingsSectionDeclaration & { tab: DeclaredTab<T> })[]
  sectionIds: DeclaredSection<T>['id'][]
  surfaces: { id: DeclaredSurface<T>; settingsTarget: { tab: DeclaredTab<T>; sectionId: DeclaredSection<T>['id'] | undefined }; acceptedRefKinds: readonly string[] }[]
  surfaceIds: DeclaredSurface<T>[]
  search: { sectionId: DeclaredSection<T>['id']; labelKey: string; keywords?: readonly string[] }[]
}

/** 接受临时声明，供扩展和门禁验证；不依赖组件、Store 或 Electron。 */
export function deriveSettingsRegistration<const T extends Declaration>(declaration: T): SettingsRegistration<T> {
  type Tab = keyof T & string
  type Section = T[Tab]['sections'][number]
  type Id = Section['id']
  type SurfaceId = Section['surfaceId'] | ParentSurface<T[Tab]>
  const tabs = Object.keys(declaration) as Tab[]
  const sections = tabs.flatMap(tab => declaration[tab].sections.map(section => ({ ...section, tab })))
  const tabSections = Object.fromEntries(tabs.map(tab => [tab, declaration[tab].sections.map(section => section.id)])) as { [K in Tab]: T[K]['sections'][number]['id'][] }
  const surfaces = tabs.flatMap(tab => {
    const parent = declaration[tab].surface
    return [
      ...(parent ? [{ id: parent.id as SurfaceId, settingsTarget: { tab, sectionId: undefined as Id | undefined },
        acceptedRefKinds: [] as readonly string[], surfaceOrder: parent.surfaceOrder, schemaOrder: parent.schemaOrder }] : []),
      ...declaration[tab].sections.map(section => ({ id: section.surfaceId as SurfaceId,
        settingsTarget: { tab, sectionId: section.id as Id | undefined }, acceptedRefKinds: section.acceptedRefKinds ?? [],
        surfaceOrder: section.surfaceOrder, schemaOrder: section.schemaOrder })),
    ]
  })
  const search = sections.flatMap(section => (section.search ?? [{ labelKey: section.titleKey, order: section.surfaceOrder }])
    .map(row => ({ sectionId: section.id as Id, ...row })))
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...entry }) => entry)
  return {
    tabs, tabSections, sections,
    sectionIds: sections.map(section => section.id as Id),
    surfaces: [...surfaces].sort((left, right) => left.surfaceOrder - right.surfaceOrder)
      .map(({ surfaceOrder: _surfaceOrder, schemaOrder: _schemaOrder, ...surface }) => surface),
    surfaceIds: [...surfaces].sort((left, right) => left.schemaOrder - right.schemaOrder).map(surface => surface.id),
    search,
  }
}

export const SETTINGS_REGISTRATION = deriveSettingsRegistration(SETTINGS_DECLARATION)
export const SETTINGS_TAB_SECTIONS = SETTINGS_REGISTRATION.tabSections
export const SETTINGS_TAB_IDS = SETTINGS_REGISTRATION.tabs
export const SETTINGS_SECTION_IDS = SETTINGS_REGISTRATION.sectionIds

/** 属性只引用分区 ID，大类与标题由同一声明提供。 */
export function settingsTarget(sectionId: SettingsSectionId): SettingsNavigationTarget {
  const section = SETTINGS_REGISTRATION.sections.find(section => section.id === sectionId)
  if (!section) throw new Error(`设置分区未登记：${sectionId}`)
  return { tab: section.tab, sectionId }
}

export function settingsSectionTitleKey(sectionId: string): string {
  const section = SETTINGS_REGISTRATION.sections.find(section => section.id === sectionId)
  if (!section) throw new Error(`设置分区未登记：${sectionId}`)
  return section.titleKey
}
