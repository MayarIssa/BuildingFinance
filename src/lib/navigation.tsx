"use client"

import { Suspense, useCallback, useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

// Keeps a small stack of the in-app pages visited in this tab, so a Back
// button can go one real step back (Dashboard → Apartments → Unit 101 →
// Back = Apartments) and only falls back to a parent page when the user
// landed directly on a detail page (e.g. from a bookmark). Views that
// should be their own step — apartment details, a unit's payments — are
// URLs, so the phone's own back button walks the same steps.

const KEY = "buildfin.navstack"
const MAX = 50

function readStack(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

function writeStack(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)))
  } catch {
    /* storage unavailable — Back falls back to the parent page */
  }
}

function Tracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()

  useEffect(() => {
    const url = query ? `${pathname}?${query}` : pathname
    const stack = readStack()
    if (stack[stack.length - 1] === url) return
    if (stack[stack.length - 2] === url) stack.pop() // went back
    else stack.push(url)
    writeStack(stack)
  }, [pathname, query])

  return null
}

export function NavigationTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  )
}

/** Go back one in-app step; open `fallback` when there is no step to go back to. */
export function useBack(fallback: string) {
  const router = useRouter()
  return useCallback(() => {
    if (readStack().length > 1) router.back()
    else router.push(fallback)
  }, [router, fallback])
}

/** "/guest" inside the demo, "" in the real app — prefix for in-app links */
export function useBasePath(): string {
  const pathname = usePathname()
  return pathname.startsWith("/guest") ? "/guest" : ""
}
