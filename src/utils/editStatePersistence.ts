import { createLogger } from '@/core/logging'
import { appLocalDataDir, exists, join, mkdir, readFile, remove, writeFile } from '@/platform/desktopApi'

const logger = createLogger('utils.editStatePersistence')

const DIR_NAME = 'EditStates'
const APP_DIR = 'Henji-AI'

async function getEditStateDir(): Promise<string> {
        const appDataDir = await appLocalDataDir()
        const fullPath = await join(appDataDir, APP_DIR, DIR_NAME)
    return fullPath
}

async function getEditStatePath(taskId: string): Promise<string> {
    const dir = await getEditStateDir()
    return await join(dir, `${taskId}.json`)
}

/**
 * Save edit states to a JSON file
 * @param taskId The task ID to associate with the edit state
 * @param states The edit states to save
 * @returns The filename of the saved state file
 */
export async function saveEditState(taskId: string, states: DynamicValueMap): Promise<string> {
    try {
        const dir = await getEditStateDir()
        const filePath = await getEditStatePath(taskId)

        // Ensure directory exists
        await mkdir(dir, { recursive: true })

        const data = JSON.stringify(states)
        const encoder = new TextEncoder()
        await writeFile(filePath, encoder.encode(data))

        logger.info('[EditState] Saved edit state to file', filePath)
        return `${taskId}.json`
    } catch (error) {
        logger.error('[EditState] Failed to save edit state', error)
        throw error
    }
}

/**
 * Load edit states from a JSON file
 * @param taskIdOrFilename The task ID or filename (e.g., "123" or "123.json")
 */
export async function loadEditState(taskIdOrFilename: string): Promise<DynamicValueMap | null> {
    try {
        const dir = await getEditStateDir()
        const filename = taskIdOrFilename.endsWith('.json') ? taskIdOrFilename : `${taskIdOrFilename}.json`
        const filePath = await join(dir, filename)

        const fileExists = await exists(filePath)
        if (!fileExists) {
            logger.info('[EditState] Edit state file not found', filePath)
            return null
        }

        const content = await readFile(filePath)
        const decoder = new TextDecoder()
        const jsonStr = decoder.decode(content)

        return JSON.parse(jsonStr)
    } catch (error) {
        logger.error('[EditState] Failed to load edit state', error)
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
        const filePath = await join(dir, filename)

        const fileExists = await exists(filePath)
        if (fileExists) {
            await remove(filePath)
            logger.info('[EditState] Deleted edit state file', filePath)
        }
    } catch (error) {
        logger.error('[EditState] Failed to delete edit state', error)
    }
}

