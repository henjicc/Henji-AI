import path from 'node:path'

import { getDataRootDir } from '../image/path-utils'

export interface ImageEditorV3StoragePaths {
  rootDir: string
  documentsDir: string
  resourcesDir: string
  materializationsDir: string
}

/** 图片编辑 V3 权威持久层的唯一目录契约，IPC 与项目包适配器必须共享。 */
export function getImageEditorV3StoragePaths(dataRootDir = getDataRootDir()): ImageEditorV3StoragePaths {
  const rootDir = path.join(dataRootDir, 'ImageEditorV3')
  return {
    rootDir,
    documentsDir: path.join(rootDir, 'documents'),
    resourcesDir: path.join(rootDir, 'resources'),
    materializationsDir: path.join(rootDir, 'materializations'),
  }
}
