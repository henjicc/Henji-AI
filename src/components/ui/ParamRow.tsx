import React from 'react'

type ParamRowProps = {
  children: React.ReactNode
  className?: string
}

export default function ParamRow(props: ParamRowProps) {
  const { children, className } = props
  return (
    <div className={`flex flex-wrap items-end gap-x-3 gap-y-2 ${className || ''}`}>{children}</div>
  )
}

