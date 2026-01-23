import { useState, useCallback } from 'react'

/**
 * 编辑器状态管理
 * 职责：管理图片编辑器的核心状态
 */

interface EditorState {
  imageUrl: string | null
  scale: number
  rotation: number
  brightness: number
  contrast: number
  saturation: number
}

const DEFAULT_STATE: EditorState = {
  imageUrl: null,
  scale: 1,
  rotation: 0,
  brightness: 100,
  contrast: 100,
  saturation: 100
}

export const useEditorState = (initialImageUrl?: string) => {
  const [state, setState] = useState<EditorState>({
    ...DEFAULT_STATE,
    imageUrl: initialImageUrl || null
  })

  const setImageUrl = useCallback((url: string | null) => {
    setState(prev => ({ ...prev, imageUrl: url }))
  }, [])

  const setScale = useCallback((scale: number) => {
    setState(prev => ({ ...prev, scale }))
  }, [])

  const setRotation = useCallback((rotation: number) => {
    setState(prev => ({ ...prev, rotation }))
  }, [])

  const setBrightness = useCallback((brightness: number) => {
    setState(prev => ({ ...prev, brightness }))
  }, [])

  const setContrast = useCallback((contrast: number) => {
    setState(prev => ({ ...prev, contrast }))
  }, [])

  const setSaturation = useCallback((saturation: number) => {
    setState(prev => ({ ...prev, saturation }))
  }, [])

  const resetState = useCallback(() => {
    setState(DEFAULT_STATE)
  }, [])

  return {
    state,
    setImageUrl,
    setScale,
    setRotation,
    setBrightness,
    setContrast,
    setSaturation,
    resetState
  }
}
