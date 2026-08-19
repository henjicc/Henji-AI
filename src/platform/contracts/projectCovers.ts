export type ProjectCoverScope = 'canvas' | 'camera-stage'
export type ProjectCoverSourceKind = 'image' | 'video'

export interface ProjectCoverPlatformRequest {
  scope: ProjectCoverScope
  projectId: string
  /** 任意媒体形态：本地路径 / file:// / henji-media:// / http(s) / data: */
  source: string
  sourceKind: ProjectCoverSourceKind
}

export interface ProjectCoverPlatformResult {
  projectId: string
  coverPath: string | null
}

export interface ProjectCoversPlatform {
  saveCover(request: ProjectCoverPlatformRequest): Promise<ProjectCoverPlatformResult>
}
