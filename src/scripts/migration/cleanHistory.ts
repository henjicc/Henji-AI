/**
 * Data Cleaning Logic
 *
 * Cleans legacy history items and converts to new format
 */

import type { LegacyHistoryItem } from './types'
import type { HistoryRecord } from '@/services/database/types'

/**
 * Clean a legacy history item
 *
 * Key cleaning rules:
 * - Remove all Base64 data from result.url
 * - Only keep filePath
 * - Remove sensitive parameters (uploadedImages, uploadedVideos, etc.)
 * - Validate required fields
 *
 * @param legacy - Legacy history item
 * @returns Cleaned record or null if invalid
 */
export function cleanHistoryItem(
  legacy: LegacyHistoryItem
): Omit<HistoryRecord, 'createdAt' | 'updatedAt'> | null {
  try {
    // Validate required fields
    if (!legacy.id || !legacy.provider || !legacy.model || !legacy.type) {
      console.warn(`[Clean] Skipping invalid record: ${legacy.id}`)
      return null
    }

    // Extract file path (absolutely no Base64)
    let filePath: string | null = null

    if (legacy.result?.filePath) {
      // Clean file path
      filePath = legacy.result.filePath
        .replace(/\\/g, '/')  // Normalize to forward slashes
        .trim()

      // Validate path format
      if (!filePath || filePath.startsWith('data:')) {
        console.warn(`[Clean] Invalid file path: ${legacy.id}`)
        filePath = null
      }
    }

    // If no valid file path, skip this record
    if (!filePath) {
      console.warn(`[Clean] Skipping record without file path: ${legacy.id}`)
      return null
    }

    // Clean parameters (remove sensitive data)
    const params = { ...legacy.settings }

    // Remove fields that may contain Base64
    delete params.uploadedImages
    delete params.uploadedVideos
    delete params.imageDataUrl
    delete params.videoDataUrl

    // Convert timestamp to ISO string
    const createdAt = new Date(legacy.timestamp).toISOString()

    // Convert to new format
    return {
      id: legacy.id,
      providerId: legacy.provider,
      modelId: legacy.model,
      type: legacy.type,
      prompt: legacy.prompt || null,
      params,
      filePath,
      taskId: legacy.result?.taskId || null,
      status: 'completed',
      errorMessage: null,
      cost: null,  // Old data doesn't have cost info
      duration: null,  // Old data doesn't have duration info
    }
  } catch (error) {
    console.error(`[Clean] Failed to clean record: ${legacy.id}`, error)
    return null
  }
}
