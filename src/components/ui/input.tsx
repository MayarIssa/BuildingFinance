"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// Field types the browser opens a picker for. By default only the small
// calendar icon opens it; these fields open the picker on a click anywhere
// in the field instead.
const PICKER_TYPES = new Set(["date", "month", "week", "time", "datetime-local"])

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, onClick, ...props }, ref) => {
    const hasPicker = type !== undefined && PICKER_TYPES.has(type)

    function handleClick(e: React.MouseEvent<HTMLInputElement>) {
      onClick?.(e)
      if (!hasPicker || e.defaultPrevented || props.disabled || props.readOnly) return
      try {
        e.currentTarget.showPicker?.()
      } catch {
        // showPicker throws if the page isn't focused or the browser
        // refuses — the built-in icon still works then
      }
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          hasPicker && "cursor-pointer",
          className
        )}
        ref={ref}
        onClick={handleClick}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
