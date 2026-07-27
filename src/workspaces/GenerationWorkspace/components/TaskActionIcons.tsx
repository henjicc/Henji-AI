import React from 'react'
import { ArrowUpRight, Copy, Download } from 'lucide-react'

interface IconProps {
  className?: string
}

export function CopyIcon({ className }: IconProps): JSX.Element {
  return (
    <Copy className={className} />
  )
}

export function DownloadIcon({ className }: IconProps): JSX.Element {
  return (
    <Download className={className} />
  )
}

export function UsePromptIcon({ className }: IconProps): JSX.Element {
  return (
    <ArrowUpRight className={className} />
  )
}
