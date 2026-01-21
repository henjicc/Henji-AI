/**
 * Legacy History Item Type
 *
 * Type definition for old history.json format
 */

export interface LegacyHistoryItem {
  id: string
  provider: string
  model: string
  type: 'image' | 'video' | 'audio'
  prompt: string
  result: {
    url?: string
    filePath?: string
    taskId?: string
  }
  timestamp: number
  settings: Record<string, any>
}

/**
 * Migration Statistics
 */
export interface MigrationStats {
  totalRecords: number
  base64Count: number
  base64Size: number
  validFilePathCount: number
  missingFileCount: number
  typeStats: Record<string, number>
  providerStats: Record<string, number>
}
