import type { ProjectPackagePlatform } from '@/platform/contracts/projectPackage'

const DOMAIN = 'projectPackage'

function getNativeProjectPackage(): NonNullable<typeof window.henjiNative>['projectPackage'] {
  const native = window.henjiNative
  if (!native?.projectPackage) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.projectPackage is not available`)
  }
  return native.projectPackage
}

export function createElectronProjectPackage(): ProjectPackagePlatform {
  return {
    exportProjectPackage: (manifestJson, mediaFiles, targetPath) =>
      getNativeProjectPackage().exportProjectPackage(manifestJson, mediaFiles, targetPath),
    importProjectPackage: (zipPath) =>
      getNativeProjectPackage().importProjectPackage(zipPath),
  }
}
