import { exportHenjiImagePackage, type ExportHenjiImagePackageRequest } from './package-export'
import { importHenjiImagePackage, type ImportedHenjiImagePackage } from './package-import'
import type { ContentAddressedResourceStore } from './resource-store'
import type { HenjiImagePackageLimits, HenjiImagePackageManifest } from './package-types'

export class HenjiImagePackageCodec {
  constructor(private readonly resourceStore: ContentAddressedResourceStore) {}

  export(
    request: Omit<ExportHenjiImagePackageRequest, 'resourceStore'>,
  ): Promise<HenjiImagePackageManifest> {
    return exportHenjiImagePackage({ ...request, resourceStore: this.resourceStore })
  }

  import(
    sourcePath: string,
    options: { limits?: Partial<HenjiImagePackageLimits>; signal?: AbortSignal } = {},
  ): Promise<ImportedHenjiImagePackage> {
    return importHenjiImagePackage({
      sourcePath,
      resourceStore: this.resourceStore,
      limits: options.limits,
      signal: options.signal,
    })
  }
}
