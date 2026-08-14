import React, { type ButtonHTMLAttributes, type ReactNode, type SVGAttributes } from 'react'

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

/** Transparent tooltip stand-in; the shortcut button's accessible label remains the test contract. */
export function Tooltip({ children }: { readonly children?: ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

/** Minimal glyph stand-in used by Explain shortcut tests. */
export function IconSparkle16(props: SVGAttributes<SVGElement>) {
  return React.createElement('svg', { ...props, 'aria-hidden': true })
}
