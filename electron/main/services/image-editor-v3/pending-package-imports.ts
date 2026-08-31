import crypto from 'node:crypto'

import type { ResourceDescriptor, ResourceId, ResourceLease } from './contracts'
import type {
  HenjiImageMissingExternalSource,
  ImportedHenjiImagePackage,
} from './package-import'

export type PendingHenjiImagePackageRef = `image-edit-package-open:${string}`

export interface PendingHenjiImagePackageImport {
  ref: PendingHenjiImagePackageRef
  ownerId: number
  imported: ImportedHenjiImagePackage
  resources: Map<ResourceId, ResourceDescriptor>
  missingExternalSources: Map<ResourceId, HenjiImageMissingExternalSource>
  supplementalLeases: ResourceLease[]
}

function createPendingRef(): PendingHenjiImagePackageRef {
  return `image-edit-package-open:${crypto.randomUUID()}`
}

/**
 * 外链包在 UI 完成重链前不能写入文档库；该注册表只保存内存态 manifest、已导入资源 lease
 * 和不可猜测 token，且 token 同时绑定发起它的 renderer。
 */
export class PendingHenjiImagePackageImportRegistry {
  private readonly records = new Map<PendingHenjiImagePackageRef, PendingHenjiImagePackageImport>()

  async create(
    ownerId: number,
    imported: ImportedHenjiImagePackage,
  ): Promise<PendingHenjiImagePackageImport> {
    await this.abandonOwner(ownerId)
    const record: PendingHenjiImagePackageImport = {
      ref: createPendingRef(),
      ownerId,
      imported,
      resources: new Map(imported.resources.map((resource) => [resource.id, resource])),
      missingExternalSources: new Map(
        imported.missingExternalSources.map((source) => [source.resourceId, source]),
      ),
      supplementalLeases: [],
    }
    this.records.set(record.ref, record)
    return record
  }

  get(
    ownerId: number,
    ref: PendingHenjiImagePackageRef,
  ): PendingHenjiImagePackageImport {
    const record = this.records.get(ref)
    if (!record || record.ownerId !== ownerId) throw new Error('Pending image package is unavailable')
    return record
  }

  addRelinkedResource(
    record: PendingHenjiImagePackageImport,
    resource: ResourceDescriptor,
    lease: ResourceLease,
  ): void {
    if (!record.missingExternalSources.has(resource.id)) {
      throw new Error(`External package resource is not pending: ${resource.id}`)
    }
    record.resources.set(resource.id, resource)
    record.missingExternalSources.delete(resource.id)
    record.supplementalLeases.push(lease)
  }

  takeReady(
    ownerId: number,
    ref: PendingHenjiImagePackageRef,
  ): PendingHenjiImagePackageImport {
    const record = this.get(ownerId, ref)
    if (record.missingExternalSources.size > 0) {
      throw new Error('Image package still has missing external resources')
    }
    this.records.delete(ref)
    return record
  }

  async abandon(ownerId: number, ref: PendingHenjiImagePackageRef): Promise<boolean> {
    const record = this.records.get(ref)
    if (!record || record.ownerId !== ownerId) return false
    this.records.delete(ref)
    await this.release(record)
    return true
  }

  async abandonOwner(ownerId: number): Promise<void> {
    const owned = [...this.records.values()].filter((record) => record.ownerId === ownerId)
    for (const record of owned) this.records.delete(record.ref)
    await Promise.all(owned.map((record) => this.release(record)))
  }

  async dispose(): Promise<void> {
    const records = [...this.records.values()]
    this.records.clear()
    await Promise.all(records.map((record) => this.release(record)))
  }

  async release(record: PendingHenjiImagePackageImport): Promise<void> {
    await Promise.all([
      record.imported.resourceLease.release(),
      ...record.supplementalLeases.map((lease) => lease.release()),
    ])
  }
}
