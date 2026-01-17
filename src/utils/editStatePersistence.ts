import { writeFile, readFile, mkdir, remove, exists } from '@tauri-apps/plugin-fs'
import * as path from '@tauri-apps/api/path'
import { logError, logInfo } from './errorLogger'

const DIR_NAME = 'EditStates'
const APP_DIR = 'Henji-AI'

async function getEditStateDir(): Promise<string> {
    const appDataDir = await path.appLocalDataDir()
    const fullPath = await path.join(appDataDir, APP_DIR, DIR_NAME)
    return fullPath
}

async function getEditStatePath(taskId: string): Promise<string> {
    const dir = await getEditStateDir()
    return await path.join(dir, `${taskId}.json`)
}

/**
 * Save edit states to a JSON file
 * @param taskId The task ID to associate with the edit state
 * @param states The edit states to save
 * @returns The filename of the saved state file
 */
export async function saveEditState(taskId: string, states: Record<string, any>): Promise<string> {
    try {
        const dir = await getEditStateDir()
        const filePath = await getEditStatePath(taskId)

        // Ensure directory exists
        await mkdir(dir, { recursive: true })

        const data = JSON.stringify(states)
        const encoder = new TextEncoder()
        await writeFile(filePath, encoder.encode(data))

        logInfo('[EditState] Saved edit state to file', filePath)
        return `${taskId}.json`
    } catch (error) {
        logError('[EditState] Failed to save edit state', error)
        throw error
    }
}

/**
 * Load edit states from a JSON file
 * @param taskIdOrFilename The task ID or filename (e.g., "123" or "123.json")
 */
export async function loadEditState(taskIdOrFilename: string): Promise<Record<string, any> | null> {
    try {
        const dir = await getEditStateDir()
        const filename = taskIdOrFilename.endsWith('.json') ? taskIdOrFilename : `${taskIdOrFilename}.json`
        const filePath = await path.join(dir, filename)

        const fileExists = await exists(filePath)
        if (!fileExists) {
            logInfo('[EditState] Edit state file not found', filePath)
            return null
        }

        const content = await readFile(filePath)
        const decoder = new TextDecoder()
        const jsonStr = decoder.decode(content)

        return JSON.parse(jsonStr)
    } catch (error) {
        logError('[EditState] Failed to load edit state', error)
        return null
    }
}

/**
 * Delete edit state file
 */
export async function deleteEditState(taskIdOrFilename: string): Promise<void> {
    try {
        const dir = await getEditStateDir()
        const filename = taskIdOrFilename.endsWith('.json') ? taskIdOrFilename : `${taskIdOrFilename}.json`
        const filePath = await path.join(dir, filename)

        const fileExists = await exists(filePath)
        if (fileExists) {
            await remove(filePath)
            logInfo('[EditState] Deleted edit state file', filePath)
        }
    } catch (error) {
        logError('[EditState] Failed to delete edit state', error)
    }
}
