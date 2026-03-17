const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = process.cwd()
const MODEL_ROOT = path.join(ROOT, 'src', 'models')
const LOCALE_ROOT = path.join(ROOT, 'src', 'i18n', 'locales')
const MODEL_LOCALE_FILES = ['models-ppio.json', 'models-fal.json', 'models-kie.json', 'models-modelscope.json']

const SHARED_MAP = new Map([
  ['Aspect Ratio', { helper: 'sharedFieldText', key: 'aspectRatio' }],
  ['Auto', { helper: 'sharedOptionText', key: 'auto' }],
  ['Base Size', { helper: 'sharedFieldText', key: 'baseSize' }],
  ['CFG Scale', { helper: 'sharedFieldText', key: 'cfgScale' }],
  ['Camera Fixed', { helper: 'sharedFieldText', key: 'cameraFixed' }],
  ['Character Orientation', { helper: 'sharedFieldText', key: 'characterOrientation' }],
  ['Consistent with Image', { helper: 'sharedOptionText', key: 'consistentWithImage' }],
  ['Consistent with Video', { helper: 'sharedOptionText', key: 'consistentWithVideo' }],
  ['Default', { helper: 'sharedOptionText', key: 'default' }],
  ['Duration', { helper: 'sharedFieldText', key: 'duration' }],
  ['Fast Mode', { helper: 'sharedFieldText', key: 'fastMode' }],
  ['Fixed Camera', { helper: 'sharedFieldText', key: 'fixedCamera' }],
  ['Generate Audio', { helper: 'sharedFieldText', key: 'generateAudio' }],
  ['Guidance', { helper: 'sharedFieldText', key: 'guidance' }],
  ['HD 2K', { helper: 'sharedOptionText', key: 'hd2k' }],
  ['High', { helper: 'sharedOptionText', key: 'high' }],
  ['Image to Video', { helper: 'sharedModeText', key: 'imageToVideo' }],
  ['Image Size', { helper: 'sharedFieldText', key: 'imageSize' }],
  ['Keep Audio', { helper: 'sharedFieldText', key: 'keepAudio' }],
  ['Keep Original Sound', { helper: 'sharedFieldText', key: 'keepOriginalSound' }],
  ['Match Image', { helper: 'sharedOptionText', key: 'matchImage' }],
  ['Match Video', { helper: 'sharedOptionText', key: 'matchVideo' }],
  ['Model', { helper: 'sharedFieldText', key: 'model' }],
  ['Mode', { helper: 'sharedFieldText', key: 'mode' }],
  ['Motion Control', { helper: 'sharedModeText', key: 'motionControl' }],
  ['Negative Prompt', { helper: 'sharedFieldText', key: 'negativePrompt' }],
  ['Normal', { helper: 'sharedOptionText', key: 'normal' }],
  ['Number of Images', { helper: 'sharedFieldText', key: 'numberOfImages' }],
  ['Pro', { helper: 'sharedOptionText', key: 'pro' }],
  ['Professional', { helper: 'sharedOptionText', key: 'professional' }],
  ['Quality', { helper: 'sharedFieldText', key: 'quality' }],
  ['Reference to Video', { helper: 'sharedModeText', key: 'referenceToVideo' }],
  ['Resolution', { helper: 'sharedFieldText', key: 'resolution' }],
  ['Set to 1 to generate a single image; greater than 1 will generate multiple images. Total reference + generated images cannot exceed 15.', { helper: 'sharedText', key: 'tips.numberOfImagesLimit' }],
  ['Smart', { helper: 'sharedOptionText', key: 'smart' }],
  ['Standard', { helper: 'sharedOptionText', key: 'standard' }],
  ['Start-End Frame', { helper: 'sharedModeText', key: 'startEndFrame' }],
  ['Start/End Frame', { helper: 'sharedModeText', key: 'startEndFrame', fallback: 'Start/End Frame' }],
  ['Steps', { helper: 'sharedFieldText', key: 'steps' }],
  ['Style', { helper: 'sharedFieldText', key: 'style' }],
  ['Text to Video', { helper: 'sharedModeText', key: 'textToVideo' }],
  ['Text/Image to Video', { helper: 'sharedModeText', key: 'textImageToVideo' }],
  ['UHD 4K', { helper: 'sharedOptionText', key: 'uhd4k' }],
  ['Version', { helper: 'sharedFieldText', key: 'version' }],
  ['Video Edit', { helper: 'sharedModeText', key: 'videoEdit' }],
  ['Video Extension', { helper: 'sharedModeText', key: 'videoExtension' }],
  ['Video Reference', { helper: 'sharedModeText', key: 'videoReference' }],
  ['When enabled, the model will automatically optimize prompts for better generation results. Currently only supports standard mode.', { helper: 'sharedText', key: 'tips.promptOptimization' }],
])

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

function getPropertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
    return node.text
  }
  return null
}

function getStringValue(expr) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text
  }
  return null
}

function getPrimitiveValue(expr) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text
  if (ts.isNumericLiteral(expr)) return expr.text
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return 'true'
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return 'false'
  return null
}

function findObjectProperty(objectLiteral, propName) {
  return objectLiteral.properties.find((prop) =>
    ts.isPropertyAssignment(prop) && getPropertyName(prop.name) === propName
  )
}

function findNearestObject(node, predicate) {
  let current = node.parent
  while (current) {
    if (ts.isObjectLiteralExpression(current) && predicate(current)) {
      return current
    }
    current = current.parent
  }
  return null
}

function slugify(value) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase() || 'text'
}

function getOptionContext(node) {
  const optionObject = findNearestObject(node, (obj) => Boolean(findObjectProperty(obj, 'value')))
  if (!optionObject) return null
  const valueProp = findObjectProperty(optionObject, 'value')
  if (!valueProp || !ts.isPropertyAssignment(valueProp)) return null
  return getPrimitiveValue(valueProp.initializer)
}

function getParamContext(node) {
  const paramObject = findNearestObject(node, (obj) => Boolean(findObjectProperty(obj, 'id')))
  if (!paramObject) return null
  const idProp = findObjectProperty(paramObject, 'id')
  if (!idProp || !ts.isPropertyAssignment(idProp)) return null
  return getStringValue(idProp.initializer)
}

function buildSharedExpression(entry, fallback) {
  const args = [JSON.stringify(entry.key)]
  if (entry.fallback && entry.fallback !== fallback) {
    args.push(JSON.stringify(fallback))
  } else if (entry.fallback) {
    args.push(JSON.stringify(entry.fallback))
  }
  return `${entry.helper}(${args.join(', ')})`
}

function buildScopedExpression(pathValue, fallback) {
  return `modelScopedText(${JSON.stringify(pathValue)}, ${JSON.stringify(fallback)})`
}

function setNestedValue(obj, pathSegments, value) {
  let current = obj
  for (let i = 0; i < pathSegments.length - 1; i += 1) {
    const segment = pathSegments[i]
    if (!current[segment] || typeof current[segment] !== 'object') {
      current[segment] = {}
    }
    current = current[segment]
  }
  current[pathSegments[pathSegments.length - 1]] = value
}

function cleanupEmptyObjects(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
  for (const key of Object.keys(obj)) {
    cleanupEmptyObjects(obj[key])
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && Object.keys(obj[key]).length === 0) {
      delete obj[key]
    }
  }
}

function migrateModelFile(file, localeMap) {
  const source = fs.readFileSync(file, 'utf8')
  const modelIdMatch = source.match(/i18nScope:\s*'models\.defs\.([^']+)'/)
  if (!modelIdMatch) return
  const modelId = modelIdMatch[1]
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const replacements = []
  const helpers = new Set()

  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const keyProp = findObjectProperty(node, 'key')
      const fallbackProp = findObjectProperty(node, 'fallback')
      if (keyProp && fallbackProp && ts.isPropertyAssignment(keyProp) && ts.isPropertyAssignment(fallbackProp)) {
        const keyValue = getStringValue(keyProp.initializer)
        const fallbackValue = getStringValue(fallbackProp.initializer)
        if (keyValue && fallbackValue && keyValue.startsWith('auto.')) {
          const oldAutoKey = keyValue.slice('auto.'.length)
          const parentProp = ts.isPropertyAssignment(node.parent) ? getPropertyName(node.parent.name) : null
          const paramId = getParamContext(node)
          const optionValue = getOptionContext(node)
          const shared = SHARED_MAP.get(fallbackValue)

          let replacementText = ''
          let localeTarget = null

          if (shared) {
            helpers.add(shared.helper)
            replacementText = buildSharedExpression(shared, fallbackValue)
          } else if (parentProp === 'name' && paramId) {
            helpers.add('modelScopedText')
            localeTarget = `params.${paramId}.name`
            replacementText = buildScopedExpression(localeTarget, fallbackValue)
          } else if (parentProp === 'tooltip' && paramId) {
            helpers.add('modelScopedText')
            localeTarget = `params.${paramId}.tooltip`
            replacementText = buildScopedExpression(localeTarget, fallbackValue)
          } else if (parentProp === 'description' && paramId) {
            helpers.add('modelScopedText')
            localeTarget = `params.${paramId}.description`
            replacementText = buildScopedExpression(localeTarget, fallbackValue)
          } else if (parentProp === 'label' && paramId && optionValue) {
            helpers.add('modelScopedText')
            localeTarget = `params.${paramId}.options.${slugify(String(optionValue))}`
            replacementText = buildScopedExpression(localeTarget, fallbackValue)
          } else {
            helpers.add('modelScopedText')
            localeTarget = `texts.${slugify(fallbackValue)}`
            replacementText = buildScopedExpression(localeTarget, fallbackValue)
          }

          replacements.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            text: replacementText,
          })

          if (!localeMap[modelId]) {
            localeMap[modelId] = {}
          }
          localeMap[modelId][oldAutoKey] = localeTarget
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  if (replacements.length === 0) return

  let nextSource = source
  replacements.sort((a, b) => b.start - a.start).forEach((replacement) => {
    nextSource = `${nextSource.slice(0, replacement.start)}${replacement.text}${nextSource.slice(replacement.end)}`
  })

  if (helpers.size > 0) {
    const helperList = Array.from(helpers).sort()
    nextSource = nextSource.replace(
      /import\s*{([^}]+)}\s*from\s*'@\/core'/,
      (_, imports) => {
        const existing = imports
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
        const merged = Array.from(new Set([...existing, ...helperList])).sort()
        return `import { ${merged.join(', ')} } from '@/core'`
      }
    )
  }

  fs.writeFileSync(file, nextSource)
}

function migrateLocaleFiles(localeMap) {
  for (const locale of ['zh-CN', 'en-US']) {
    for (const name of MODEL_LOCALE_FILES) {
      const file = path.join(LOCALE_ROOT, locale, name)
      const json = JSON.parse(fs.readFileSync(file, 'utf8'))
      const defs = json.defs || {}

      Object.entries(localeMap).forEach(([modelId, autoEntries]) => {
        const model = defs[modelId]
        if (!model || !model.auto) return

        Object.entries(autoEntries).forEach(([autoKey, localeTarget]) => {
          const value = model.auto[autoKey]
          if (value === undefined) return
          if (localeTarget) {
            setNestedValue(model, localeTarget.split('.'), value)
          }
          delete model.auto[autoKey]
        })

        if (Object.keys(model.auto).length === 0) {
          delete model.auto
        }
        cleanupEmptyObjects(model)
      })

      fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
    }
  }
}

const localeMap = {}
const modelFiles = walkFiles(MODEL_ROOT, (file) => file.endsWith('.model.ts'))
modelFiles.forEach((file) => migrateModelFile(file, localeMap))
migrateLocaleFiles(localeMap)

console.log(`[migrate-model-i18n] migrated ${Object.keys(localeMap).length} models`)
