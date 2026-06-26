import { PlatformNotImplementedError } from '@/platform/types'
import type { ProjectPackagePlatform } from '@/platform/contracts/projectPackage'

const DOMAIN = 'projectPackage'

export function createElectronProjectPackage(): ProjectPackagePlatform {
  return {
    exportProjectPackage: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'exportProjectPackage')
    },
    importProjectPackage: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'importProjectPackage')
    },
  }
}
