"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Sidebar } from "./sidebar"
import { useTheme } from "@/hooks/use-theme"
import { StoreProvider } from "@/lib/store"
import { LanguageProvider } from "@/lib/i18n"
import { LayoutProvider } from "@/lib/layout"
import { ToastProvider, useToast } from "@/components/ui/use-toast"
import { Toaster } from "@/components/ui/toaster"
import { onSyncError } from "@/lib/data"
import { fetchCurrentUser } from "@/lib/auth-client"
import { NavigationTracker } from "@/lib/navigation"

// Database writes happen in the background — surface any failure as a
// toast so data never silently vanishes on the next reload
function SyncErrorToaster() {
  const { toast } = useToast()

  useEffect(() => {
    onSyncError((title, message) => {
      toast({ title, description: message, variant: "destructive", duration: 10000 })
    })
    return () => onSyncError(null)
  }, [toast])

  return null
}

// Home-screen installs keep the manifest they were installed with, so
// phones that added BuildFin while it was portrait-only stay locked until
// the install refreshes. Installed apps may set their own orientation:
// ask for "any" on every launch so rotation follows the phone right away.
function OrientationUnlock() {
  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>
    }
    if (!standalone || typeof orientation?.lock !== "function") return
    orientation.lock("any").catch(() => {
      // not allowed here (browser tab, desktop) — nothing to do
    })
  }, [])

  return null
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCurrentUser().then(({ user, status }) => {
      if (user) {
        setChecked(true)
      } else if (status === 401) {
        router.replace("/auth/login")
      } else if (status === 503) {
        setError("The database is not connected yet. Add MONGODB_URI in the Vercel project settings, then redeploy.")
      } else {
        setError("Could not reach the server. Check your connection and reload the page.")
      }
    })
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center text-sm text-destructive">{error}</div>
      </div>
    )
  }

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  return <>{children}</>
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme()
  const pathname = usePathname()

  const isPublicRoute =
    pathname.startsWith("/auth") || pathname.startsWith("/guest")

  if (isPublicRoute) {
    return (
      <LanguageProvider>
        <ToastProvider>
          <OrientationUnlock />
          {children}
          <Toaster />
        </ToastProvider>
      </LanguageProvider>
    )
  }

  return (
    <LanguageProvider>
      <StoreProvider>
        <LayoutProvider>
          <ToastProvider>
            <AuthGuard>
              <NavigationTracker />
              <SyncErrorToaster />
              <OrientationUnlock />
              <div className="flex min-h-screen">
                <Sidebar theme={theme} toggleTheme={toggleTheme} />
                <main className="min-w-0 flex-1 lg:ps-64">
                  <div className="mx-auto max-w-7xl px-4 py-6 pt-20 sm:px-6 lg:px-8 lg:pt-6">
                    {children}
                  </div>
                </main>
              </div>
              <Toaster />
            </AuthGuard>
          </ToastProvider>
        </LayoutProvider>
      </StoreProvider>
    </LanguageProvider>
  )
}
