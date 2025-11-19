export async function dataUrlToFile(dataUrl: string, filename: string = 'image.jpg'): Promise<File> {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    return new File([blob], filename, { type: blob.type || 'image/jpeg' })
}

export async function urlToFile(url: string, filename: string = 'image.jpg'): Promise<File> {
    // Handle both blob: and data: URLs
    if (url.startsWith('blob:') || url.startsWith('data:')) {
        return dataUrlToFile(url, filename)
    }

    // Handle file paths (convert to blob first)
    const response = await fetch(url)
    const blob = await response.blob()
    return new File([blob], filename, { type: blob.type || 'image/jpeg' })
}
