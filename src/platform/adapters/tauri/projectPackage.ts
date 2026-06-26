import { invoke } from '@tauri-apps/api/core'
import type { ImportedProjectPackage, ProjectPackagePlatform } from '@/platform/contracts/projectPackage'

export function createTauriProjectPackage(): ProjectPackagePlatform {
  return {
    async exportProjectPackage(manifestJson, mediaFiles, targetPath) {
      await invoke('export_project_package', { manifestJson, mediaFiles, targetPath })
    },
    async importProjectPackage(zipPath) {
      return await invoke<ImportedProjectPackage>('import_project_package', { zipPath })
    },
  }
}
