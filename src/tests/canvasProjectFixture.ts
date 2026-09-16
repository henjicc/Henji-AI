import { beforeEach } from 'vitest'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { attachCanvasProject, registerCanvasProjectInstance, resetCanvasProjectInstancesForTests } from '@/features/canvas/application/canvasProjectInstances'

beforeEach(() => {
  resetCanvasProjectInstancesForTests()
  useProjectStore.setState({ currentProjectId: null, currentProject: null })
})

/** Test seed uses the same instance registration and UI attachment as project creation. */
export const setCanvasTestProjectState: typeof useProjectStore.setState = (state, replace) => {
  const detached = !useProjectStore.getState().currentProjectId ? useCanvasStore.getState() : null
  if (replace) useProjectStore.setState(state as ReturnType<typeof useProjectStore.getState>, true)
  else useProjectStore.setState(state, false)
  const project = useProjectStore.getState().currentProject
  if (project) {
    const seed = detached && detached.nodes.length && !project.nodes.length
      ? { ...project, nodes: detached.nodes, edges: detached.edges, history: detached.history } : project
    attachCanvasProject(registerCanvasProjectInstance(seed))
    if (detached) useCanvasStore.setState({ canvasViewportSize: detached.canvasViewportSize,
      selectedNodeId: detached.selectedNodeId, activeToolDialog: detached.activeToolDialog,
      imageViewer: detached.imageViewer })
  }
}
