import type {
  ModelParamPresentation,
  ParamDef,
  ParamPresentationGroup,
  ParamPresentationSection,
} from '@/core/types'

export type ParamPresentationItem =
  | { kind: 'param'; order: number; param: ParamDef }
  | { kind: 'group'; order: number; group: ParamPresentationGroup; params: ParamDef[] }

export interface ResolvedParamPresentationSection {
  section: ParamPresentationSection
  params: ParamDef[]
}

export function getPresentedParamIds(
  presentation: ModelParamPresentation | undefined
): Set<string> {
  const ids = new Set<string>()
  for (const group of presentation?.groups ?? []) {
    for (const section of group.sections) {
      for (const paramId of section.paramIds) {
        ids.add(paramId)
      }
    }
  }
  return ids
}

export function resolveParamPresentationSections(
  group: ParamPresentationGroup,
  params: ParamDef[]
): ResolvedParamPresentationSection[] {
  const paramsById = new Map(params.map((param) => [param.id, param]))
  return group.sections
    .map((section) => ({
      section,
      params: section.paramIds
        .map((paramId) => paramsById.get(paramId))
        .filter((param): param is ParamDef => param !== undefined),
    }))
    .filter(({ params: sectionParams }) => sectionParams.length > 0)
}

/**
 * 把展示组替换成一个布局项；未被分组的参数保持标准参数项。
 * 可见性应由调用方先算好，因此一个组会随其内部可见参数实时增减，空组不渲染。
 */
export function buildParamPresentationItems(
  params: ParamDef[],
  presentation: ModelParamPresentation | undefined
): ParamPresentationItem[] {
  if (!presentation?.groups.length) {
    return params.map((param) => ({ kind: 'param', order: param.order, param }))
  }

  const groupedParamIds = getPresentedParamIds(presentation)
  const items: ParamPresentationItem[] = params
    .filter((param) => !groupedParamIds.has(param.id))
    .map((param) => ({ kind: 'param' as const, order: param.order, param }))

  for (const group of presentation.groups) {
    const groupedParams = resolveParamPresentationSections(group, params)
      .flatMap(({ params: sectionParams }) => sectionParams)
    if (groupedParams.length > 0) {
      items.push({ kind: 'group', order: group.order, group, params: groupedParams })
    }
  }

  return items.sort((left, right) => left.order - right.order)
}
