const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const BASE_FILE = path.join(ROOT, 'src-tauri', 'resources', 'progress-seeds.base.json')
const LOCAL_FILE = path.join(ROOT, 'dev-data', 'progress-seeds.local.json')
const OUTPUT_FILE = path.join(ROOT, 'src-tauri', 'resources', 'progress-seeds.json')

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function normalizeSeedFile(seedFile) {
  const input = seedFile && typeof seedFile === 'object' ? seedFile : {}
  const models = input.models && typeof input.models === 'object' ? input.models : {}
  const normalizedModels = {}

  for (const modelId of Object.keys(models).sort()) {
    const model = models[modelId] && typeof models[modelId] === 'object' ? models[modelId] : {}
    const profiles = model.profiles && typeof model.profiles === 'object' ? model.profiles : {}
    const normalizedProfiles = {}

    for (const profileKey of Object.keys(profiles).sort()) {
      const profile = profiles[profileKey] && typeof profiles[profileKey] === 'object'
        ? profiles[profileKey]
        : {}
      const buckets = profile.buckets && typeof profile.buckets === 'object' ? profile.buckets : {}
      const normalizedBuckets = {}

      for (const bucketKey of Object.keys(buckets).sort()) {
        const value = Number(buckets[bucketKey])
        if (Number.isFinite(value) && value > 0) {
          normalizedBuckets[bucketKey] = Math.round(value)
        }
      }

      const globalMs = Number(profile.globalMs)
      normalizedProfiles[profileKey] = {
        globalMs: Number.isFinite(globalMs) && globalMs > 0 ? Math.round(globalMs) : 0,
      }
      if (Object.keys(normalizedBuckets).length > 0) {
        normalizedProfiles[profileKey].buckets = normalizedBuckets
      }
    }

    normalizedModels[modelId] = { profiles: normalizedProfiles }
  }

  return {
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
    generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : null,
    models: normalizedModels,
  }
}

function mergeSeedFiles(baseFile, localFile) {
  const merged = normalizeSeedFile(baseFile)
  const local = normalizeSeedFile(localFile)

  if (local.generatedAt) {
    merged.generatedAt = local.generatedAt
  }

  for (const [modelId, localModel] of Object.entries(local.models)) {
    const mergedModel = merged.models[modelId] || { profiles: {} }
    for (const [profileKey, localProfile] of Object.entries(localModel.profiles || {})) {
      const mergedProfile = mergedModel.profiles[profileKey] || { globalMs: 0 }
      mergedProfile.globalMs = localProfile.globalMs || mergedProfile.globalMs || 0
      if (localProfile.buckets && Object.keys(localProfile.buckets).length > 0) {
        mergedProfile.buckets = {
          ...(mergedProfile.buckets || {}),
          ...localProfile.buckets,
        }
      }
      mergedModel.profiles[profileKey] = mergedProfile
    }
    merged.models[modelId] = mergedModel
  }

  return normalizeSeedFile(merged)
}

function main() {
  const baseFile = normalizeSeedFile(readJson(BASE_FILE))
  const localFile = readJson(LOCAL_FILE)
  const merged = localFile ? mergeSeedFiles(baseFile, localFile) : baseFile

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true })
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')

  if (localFile) {
    console.log(`[progress-seeds] merged local seeds -> ${OUTPUT_FILE}`)
    return
  }

  console.log(`[progress-seeds] generated base seeds -> ${OUTPUT_FILE}`)
}

main()
