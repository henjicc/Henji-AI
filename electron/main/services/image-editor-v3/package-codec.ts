import { exportHenjiImagePackage, type ExportHenjiImagePackageRequest } from './package-export'
import {
  importHenjiImagePackage,
  relinkHenjiImageExternalSource,
  type HenjiImageMissingExternalSource,
  type ImportedHenjiImagePackage,
  type RelinkedHenjiImageExternalSource,
} from './package-import'
import type { SourceProvider } from './contracts'
import type { ContentAddressedResourceStore } from './resource-store'
import type { HenjiImagePackageLimits, HenjiImagePackageManifest } from './package-types'

export class HenjiImagePackageCodec {
  constructor(
    private readonly resourceStore: ContentAddressedResourceStore,
    private readonly sourceProvider?: SourceProvider,
  ) {}

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
      sourceProvider: this.sourceProvider,
      limits: options.limits,
      signal: options.signal,
    })
  }

  relinkExternalSource(
    sourcePath: string,
    externalSource: HenjiImageMissingExternalSource,
    signal?: AbortSignal,
  ): Promise<RelinkedHenjiImageExternalSource> {
    if (!this.sourceProvider) {
      throw new Error('Image package external relink requires a source provider')
    }
    return relinkHenjiImageExternalSource({
      sourcePath,
      externalSource,
      resourceStore: this.resourceStore,
      sourceProvider: this.sourceProvider,
      signal,
    })
  }
}
