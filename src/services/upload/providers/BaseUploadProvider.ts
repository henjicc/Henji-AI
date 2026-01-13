/**
 * 上传提供商接口
 */
export interface UploadProvider {
    /**
     * 提供商名称
     */
    readonly name: string

    /**
     * 上传单个文件
     * @param file - 文件对象或 base64 字符串
     * @param filename - 建议的文件名（可选）
     * @returns 上传后的 URL
     */
    upload(file: File | Blob | string, filename?: string): Promise<string>

    /**
     * 批量上传文件
     * @param files - 文件数组
     * @returns 上传后的 URL 数组
     */
    uploadMultiple(files: (File | Blob | string)[]): Promise<string[]>

    /**
     * 检查提供商是否可用（例如是否配置了 API key）
     */
    isAvailable(): boolean
}
