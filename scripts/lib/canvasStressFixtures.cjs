const GRID_COLUMNS = 10
const GRID_SPACING_X = 240
const GRID_SPACING_Y = 200

function createPromptDocument(text) {
  return {
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

function buildNodes(imageNodeCount, videoNodeCount, genNodeCount = 0, storyboardNodeCount = 0) {
  const nodes = []
  const totalCount = imageNodeCount + videoNodeCount + genNodeCount + storyboardNodeCount
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
    } else if (i < imageNodeCount + videoNodeCount) {
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
    } else if (i < imageNodeCount + videoNodeCount + genNodeCount) {
      const genIndex = i - imageNodeCount - videoNodeCount
      const prompt = `stress prompt ${genIndex}`
      nodes.push({
        id: `stress-gen-${genIndex}`,
        type: 'imageNode',
        position,
        data: {
          displayName: `压测生成 ${genIndex}`,
          prompt,
          promptDocument: createPromptDocument(prompt),
        },
      })
    } else {
      const storyboardIndex = i - imageNodeCount - videoNodeCount - genNodeCount
      const frames = Array.from({ length: 9 }, (_, frameIndex) => {
        const description = `分镜 ${frameIndex + 1} 压测描述`
        return {
          id: `stress-storyboard-${storyboardIndex}-frame-${frameIndex}`,
          description,
          descriptionDocument: createPromptDocument(description),
          referenceIndex: null,
        }
      })
      nodes.push({
        id: `stress-storyboard-${storyboardIndex}`,
        type: 'storyboardGenNode',
        position,
        data: {
          displayName: `压测分镜 ${storyboardIndex}`,
          gridRows: 3,
          gridCols: 3,
          frames,
          mediaInputs: {},
          imageUrl: null,
          previewImageUrl: null,
          aspectRatio: '16:9',
        },
      })
    }
  }
  return nodes
}

/**
 * 生成节点连线：每个生成节点接一个上传图片节点作为上游（有多少接多少），
 * 覆盖"生成节点 + 连线"这一真实业务里的主要性能路径。
 */
function buildEdges(imageNodeCount, genNodeCount) {
  const edges = []
  const wiredCount = Math.min(imageNodeCount, genNodeCount)
  for (let i = 0; i < wiredCount; i += 1) {
    edges.push({
      id: `stress-edge-${i}`,
      source: `stress-image-${i}`,
      target: `stress-gen-${i}`,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'disconnectableEdge',
    })
  }
  return edges
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

module.exports = { buildNodes, buildEdges, computeFitViewport, GRID_COLUMNS }
