export type ProjectCoverScope = 'canvas' | 'camera-stage'
export type ProjectCoverSourceKind = 'image' | 'video'

export interface ProjectCoverSource {
  /** 任意媒体形态：本地路径 / file:// / henji-media:// / http(s) / data: */
  source: string
  sourceKind: ProjectCoverSourceKind
}

export interface ProjectCoverPlatformRequest {
  scope: ProjectCoverScope
  projectId: string
  /** 1 张原图；2/3 张取前 2 张左右拼接；4 张按 2×2 拼接。 */
  sources: ProjectCoverSource[]
}

export interface ProjectCoverPlatformResult {
  projectId: string
  coverPath: string | null
}

export interface ProjectCoversPlatform {
  saveCover(request: ProjectCoverPlatformRequest): Promise<ProjectCoverPlatformResult>
}
