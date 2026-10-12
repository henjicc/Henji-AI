const { UI_AUDIT_RULES } = require('./uiAuditDom.cjs')
const LOCAL_RULES = UI_AUDIT_RULES.filter((rule) => rule.key !== 'pageTitleInconsistency')

function createPageTitleIssues(results) {
  const bySurface = new Map()
  for (const result of Object.values(results)) {
    for (const title of result.pageTitles) {
      if (!title.surface) continue
      const key = title.surface
      const current = bySurface.get(key)
      if (!current || current.scene === title.scene) {
        bySurface.set(key, title)
      }
    }
  }
  const titles = [...bySurface.values()]
  const fontSizes = [...new Set(titles.map((title) => title.fontSize))]
  if (titles.length < 2 || fontSizes.length === 1) return []
  return [{
    fontSizes,
    titles: titles.map(({ surface, scene, text, fontSize, fontWeight, lineHeight }) => ({
      surface,
      scene,
      text,
      fontSize,
      fontWeight,
      lineHeight,
    })),
  }]
}

function countIssues(results, crossScene) {
  let count = crossScene.pageTitleInconsistency.length
  for (const result of Object.values(results)) {
    for (const rule of LOCAL_RULES) {
      count += result[rule.key]?.length ?? 0
    }
  }
  return count
}

module.exports = { createPageTitleIssues, countIssues }
