import fs from 'node:fs'
import path from 'node:path'
import type { ModelManifest, ModelManifestItem } from './types'

class ModelManifestStore {
  private models = new Map<string, ModelManifestItem>()
  private canonicalCount = 0

  constructor(manifest?: ModelManifest) {
    this.canonicalCount = manifest?.models?.length ?? 0
    for (const item of manifest?.models ?? []) {
      this.models.set(item.modelId, item)
      for (const alias of item.aliases ?? []) {
        if (!this.models.has(alias)) {
          this.models.set(alias, item)
        }
      }
    }
  }

  get(modelId: string): ModelManifestItem | undefined {
    return this.models.get(modelId)
  }

  providerIds(): string[] {
    return Array.from(new Set(Array.from(this.models.values()).map((model) => model.providerId)))
  }

  len(): number {
    return this.canonicalCount
  }
}

let manifestStore = loadManifestStore()

export function getManifestStore(): ModelManifestStore {
  return manifestStore
}

export function reloadManifestStore(): number {
  manifestStore = loadManifestStore()
  return manifestStore.len()
}

function loadManifestStore(): ModelManifestStore {
  for (const candidate of getManifestCandidates()) {
    if (!fs.existsSync(candidate)) {
      continue
    }
    const content = fs.readFileSync(candidate, 'utf8')
    return new ModelManifestStore(JSON.parse(content) as ModelManifest)
  }
  return new ModelManifestStore()
}

function getManifestCandidates(): string[] {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, 'resources', 'model-manifest.json'),
  ]

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'model-manifest.json'))
    candidates.push(path.join(process.resourcesPath, 'resources', 'model-manifest.json'))
  }

  return candidates
}
