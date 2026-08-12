import React, { type ButtonHTMLAttributes, type ReactNode } from 'react'

/** Lightweight primitive stand-in that keeps learning-view tests focused on plugin behavior. */
export function Button({
  variant: _variant,
  size: _size,
  icon,
  children,
  ...props
}: {
  readonly variant?: string
  readonly size?: string
  readonly icon?: ReactNode
  readonly children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return React.createElement('button', { type: 'button', ...props }, icon, children)
}
