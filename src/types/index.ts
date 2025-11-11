export interface MediaResult {
  id: string
  type: 'image' | 'video' | 'audio'
  url: string
  prompt: string
  createdAt: Date
}

export interface Provider {
  id: string
  name: string
  type: string
  models: Model[]
}

export interface Model {
  id: string
  name: string
  type: 'image' | 'video' | 'audio'
  description: string
}