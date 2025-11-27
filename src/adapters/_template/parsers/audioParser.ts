/**
 * 音频响应解析器模板
 */

import { ResponseParser } from '../types'
import { AudioResult } from '../../base/BaseAdapter'

export const audioParser: ResponseParser<AudioResult> = {
    async parse(responseData: any, _adapter: any): Promise<AudioResult> {
        if (responseData.audio_url || responseData.url) {
            return {
                url: responseData.audio_url || responseData.url,
                status: 'completed'
            }
        }

        throw new Error('No audio found in response')
    }
}
