import type { ModelDefinition } from '@/core/types'

type ValidationFailure = (message: string) => never

/**
 * 展示组只能重排现有扁平参数：引用必须存在，且一个参数只能出现一次。
 */
export function validateParamPresentation(
  model: Pick<ModelDefinition, 'params' | 'paramPresentation'>,
  fail: ValidationFailure
): void {
  const presentation = model.paramPresentation
  if (!presentation) return

  if (!Array.isArray(presentation.groups)) {
    fail('Model paramPresentation.groups must be an array')
  }

  const paramIds = new Set(model.params.map((param) => param.id))
  const groupIds = new Set<string>()
  const presentedParamIds = new Set<string>()

  presentation.groups.forEach((group, groupIndex) => {
    const prefix = `Model paramPresentation.groups[${groupIndex}]`
    if (!group.id || typeof group.id !== 'string') {
      fail(`${prefix}.id is required and must be a string`)
    }
    if (groupIds.has(group.id)) {
      fail(`Duplicate param presentation group ID: ${group.id}`)
    }
    groupIds.add(group.id)

    if (!group.name) {
      fail(`${prefix}.name is required`)
    }
    if (typeof group.order !== 'number' || !Number.isFinite(group.order)) {
      fail(`${prefix}.order must be a finite number`)
    }
    if (group.panelWidth !== undefined && (
      typeof group.panelWidth !== 'number' || !Number.isFinite(group.panelWidth) || group.panelWidth <= 0
    )) {
      fail(`${prefix}.panelWidth must be a positive number`)
    }
    if (!Array.isArray(group.sections) || group.sections.length === 0) {
      fail(`${prefix}.sections must be a non-empty array`)
    }

    const sectionIds = new Set<string>()
    group.sections.forEach((section, sectionIndex) => {
      const sectionPrefix = `${prefix}.sections[${sectionIndex}]`
      if (!section.id || typeof section.id !== 'string') {
        fail(`${sectionPrefix}.id is required and must be a string`)
      }
      if (sectionIds.has(section.id)) {
        fail(`Duplicate param presentation section ID in ${group.id}: ${section.id}`)
      }
      sectionIds.add(section.id)

      if (!section.name) {
        fail(`${sectionPrefix}.name is required`)
      }
      if (!Array.isArray(section.paramIds) || section.paramIds.length === 0) {
        fail(`${sectionPrefix}.paramIds must be a non-empty array`)
      }

      section.paramIds.forEach((paramId) => {
        if (!paramIds.has(paramId)) {
          fail(`${sectionPrefix}.paramIds references non-existent param: ${paramId}`)
        }
        if (presentedParamIds.has(paramId)) {
          fail(`Param appears in more than one presentation section: ${paramId}`)
        }
        presentedParamIds.add(paramId)
      })
    })
  })
}
