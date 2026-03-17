const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const SRC_MODELS = path.join(ROOT, 'src', 'models')
const LOCALE_ROOT = path.join(ROOT, 'src', 'i18n', 'locales')
const PARAMS_LOCALES = ['zh-CN', 'en-US'].map((locale) => ({
  locale,
  file: path.join(LOCALE_ROOT, locale, 'params.json'),
  json: JSON.parse(fs.readFileSync(path.join(LOCALE_ROOT, locale, 'params.json'), 'utf8')),
}))
const MODEL_LOCALE_FILES = ['models-ppio.json', 'models-fal.json', 'models-kie.json', 'models-modelscope.json']

function walkFiles(dir, matcher, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(fullPath, matcher, results)
      continue
    }
    if (matcher(fullPath)) {
      results.push(fullPath)
    }
  }
  return results
}

function getNestedValue(obj, pathValue) {
  return pathValue.split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return current[key]
  }, obj)
}

function assertSharedKeyExists(pathValue, helperName, errors) {
  for (const { locale, file, json } of PARAMS_LOCALES) {
    if (getNestedValue(json, pathValue) === undefined) {
      errors.push(`${helperName} -> ${pathValue} missing in ${locale} (${file})`)
    }
  }
}

const modelFiles = walkFiles(SRC_MODELS, (file) => file.endsWith('.model.ts'))
const localeBundles = ['zh-CN', 'en-US'].flatMap((locale) =>
  MODEL_LOCALE_FILES.map((name) => {
    const file = path.join(LOCALE_ROOT, locale, name)
    return {
      locale,
      file,
      json: JSON.parse(fs.readFileSync(file, 'utf8')),
    }
  })
)

const errors = []

for (const file of modelFiles) {
  const source = fs.readFileSync(file, 'utf8')

  if (/key:\s*['"]auto\./.test(source)) {
    errors.push(`auto.N key remains in ${file}`)
  }

  const modelIdMatch = source.match(/i18nScope:\s*'models\.defs\.([^']+)'/)
  const modelId = modelIdMatch ? modelIdMatch[1] : null

  const sharedPatterns = [
    { regex: /sharedFieldText\('([^']+)'\)/g, prefix: 'fields.', helper: 'sharedFieldText' },
    { regex: /sharedOptionText\('([^']+)'\)/g, prefix: 'options.', helper: 'sharedOptionText' },
    { regex: /sharedModeText\('([^']+)'\)/g, prefix: 'modes.', helper: 'sharedModeText' },
    { regex: /sharedText\('([^']+)'\s*(?:,|\))/g, prefix: '', helper: 'sharedText' },
  ]

  for (const { regex, prefix, helper } of sharedPatterns) {
    let match
    while ((match = regex.exec(source)) !== null) {
      assertSharedKeyExists(`${prefix}${match[1]}`, `${helper} in ${file}`, errors)
    }
  }

  if (modelId) {
    const scopedRegex = /modelScopedText\('([^']+)'\s*,/g
    let match
    while ((match = scopedRegex.exec(source)) !== null) {
      const scopedPath = match[1]
      for (const bundle of localeBundles) {
        const model = bundle.json?.defs?.[modelId]
        if (!model) continue
        if (getNestedValue(model, scopedPath) === undefined) {
          errors.push(`modelScopedText -> ${modelId}.${scopedPath} missing in ${bundle.locale} (${bundle.file})`)
        }
      }
    }
  }
}

for (const bundle of localeBundles) {
  const defs = bundle.json?.defs || {}
  for (const [modelId, model] of Object.entries(defs)) {
    if (model && typeof model === 'object' && model.auto) {
      errors.push(`auto block remains in ${bundle.file} for model ${modelId}`)
    }
  }
}

if (errors.length > 0) {
  console.error('[check-model-i18n] failed:')
  errors.forEach((error) => console.error(`- ${error}`))
  process.exit(1)
}

console.log('[check-model-i18n] 通过：未发现 auto.N，公共/模型专属 i18n key 均存在。')
