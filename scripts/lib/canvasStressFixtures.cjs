const GRID_COLUMNS = 10
const GRID_SPACING_X = 240
const GRID_SPACING_Y = 200

function buildNodes(imageNodeCount, videoNodeCount) {
  const nodes = []
  const totalCount = imageNodeCount + videoNodeCount
  for (let i = 0; i < totalCount; i += 1) {
    const col = i % GRID_COLUMNS
    const row = Math.floor(i / GRID_COLUMNS)
    const position = { x: col * GRID_SPACING_X, y: row * GRID_SPACING_Y }
    if (i < imageNodeCount) {
      nodes.push({
        id: `stress-image-${i}`,
        type: 'uploadNode',
        position,
        data: {
          displayName: `压测图片 ${i}`,
          imageUrl: '__PLACEHOLDER_IMAGE__',
          previewImageUrl: null,
          aspectRatio: '1:1',
          isSizeManuallyAdjusted: false,
          sourceFileName: 'stress.png',
        },
      })
    } else {
      const videoIndex = i - imageNodeCount
      nodes.push({
        id: `stress-video-${videoIndex}`,
        type: 'videoUploadNode',
        position,
        data: {
          displayName: `压测视频 ${videoIndex}`,
          videoUrl: '__PLACEHOLDER_VIDEO__',
          previewImageUrl: null,
          aspectRatio: '16:9',
          durationSec: null,
          sourceFileName: 'plain_video.mp4',
          isSizeManuallyAdjusted: false,
        },
      })
    }
  }
  return nodes
}

function computeFitViewport(nodeCount, canvasWidth = 2560, canvasHeight = 1360) {
  const rows = Math.ceil(nodeCount / GRID_COLUMNS)
  const gridWidth = GRID_COLUMNS * GRID_SPACING_X
  const gridHeight = rows * GRID_SPACING_Y
  const zoom = Math.min(canvasWidth / gridWidth, canvasHeight / gridHeight, 1) * 0.85
  const x = (canvasWidth - gridWidth * zoom) / 2
  const y = (canvasHeight - gridHeight * zoom) / 2
  return { x, y, zoom }
}

module.exports = { buildNodes, computeFitViewport, GRID_COLUMNS }
