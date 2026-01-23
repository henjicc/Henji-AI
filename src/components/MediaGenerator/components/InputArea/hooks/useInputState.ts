import { useState, useCallback } from 'react'

/**
 * 输入状态管理
 * 职责：管理文本输入状态
 */
export const useInputState = (initialValue: string = '') => {
  const [input, setInput] = useState(initialValue)

  const handleInputChange = useCallback((value: string) => {
    setInput(value)
  }, [])

  const clearInput = useCallback(() => {
    setInput('')
  }, [])

  return {
    input,
    setInput: handleInputChange,
    clearInput
  }
}
