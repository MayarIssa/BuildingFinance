"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useStore } from "@/lib/store"
import { useI18n, LANGUAGES } from "@/lib/i18n"
import { APP_VERSION } from "@/lib/constants"
import { signOut } from "@/lib/auth-client"
import {
  LayoutDashboard,
  Building2,
  Wallet,
  Receipt,
  Settings,
  SlidersHorizontal,
  Sun,
  Moon,
  Menu,
  X,
  Globe,
  CalendarDays,
  FileText,
  LogOut,
  ChevronDown,
  type LucideIcon,
} from "lucide-react"
import { useState, useSyncExternalStore } from "react"

// ── Menu hierarchy ──
// Main categories (section headings) hold items; an item can hold
// sub-items that expand and collapse. Sub-items point at sections of
// their page (/settings#staff). The same tree renders on desktop and in
// the phone drawer.

interface NavChild {
  hash: string
  label: string
}

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  children?: NavChild[]
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Building",
    items: [
      { href: "/apartments", label: "Apartments", icon: Building2 },
      { href: "/payments", label: "Payments", icon: Wallet },
      { href: "/expenses", label: "Expenses", icon: Receipt },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    label: "Setup",
    items: [
      {
        href: "/settings",
        label: "Building Setup",
        icon: Settings,
        children: [
          { hash: "building", label: "Building info" },
          { hash: "opening-balance", label: "Starting balance" },
          { hash: "floor-plan", label: "Floor plan" },
          { hash: "categories", label: "Categories" },
          { hash: "staff", label: "Staff" },
          { hash: "history", label: "Previous years" },
          { hash: "data", label: "Data & backup" },
        ],
      },
      { href: "/appearance", label: "Settings", icon: SlidersHorizontal },
    ],
  },
]

// current location hash, kept in sync with in-page navigation
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  window.addEventListener("popstate", onChange)
  return () => {
    window.removeEventListener("hashchange", onChange)
    window.removeEventListener("popstate", onChange)
  }
}
function useLocationHash(): string {
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => ""
  )
}
// Next's <Link> changes the hash with pushState, which fires no event
function announceHashChange() {
  setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 0)
}

interface SidebarProps {
  theme: "light" | "dark"
  toggleTheme: () => void
  basePath?: string
}

export function Sidebar({ theme, toggleTheme, basePath = "" }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  // explicit open/closed per expandable item; untouched items are open
  // while you're on their page
  const [expandedMap, setExpanded] = useState<Record<string, boolean>>({})
  const expandedFor = (href: string, active: boolean) => expandedMap[href] ?? active
  const hash = useLocationHash()
  const { state } = useStore()
  const { t, lang, setLang } = useI18n()
  const buildingName = state.settings.building_name

  async function handleLogout() {
    await signOut()
    router.push("/auth/login")
  }

  return (
    <>
      {/* Phone top bar — menu button and building name; hidden on desktop */}
      <header
        className={cn(
          "fixed inset-x-0 z-[50] flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden",
          basePath ? "top-10" : "top-0"
        )}
      >
        <button
          onClick={() => setMobileOpen(true)}
          className="-ms-2 rounded-lg p-2 hover:bg-muted"
          aria-label={t("Open menu")}
        >
          <Menu className="h-5 w-5" />
        </button>
        <Building2 className="h-5 w-5 shrink-0 text-primary" />
        <span className="truncate font-semibold">{buildingName || "BuildFin"}</span>
      </header>

      {/* Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-[55] bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          // z-[60] keeps the phone drawer above everything; on desktop it sits
          // below dialogs (z-50) so wide dialogs aren't covered
          "fixed inset-y-0 start-0 z-[60] w-64 flex-col border-e border-sidebar-border bg-sidebar lg:z-40",
          mobileOpen ? "flex" : "hidden lg:flex"
        )}
      >
        {/* Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-6">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-6 w-6 shrink-0 text-primary" />
            <span className="truncate text-lg font-semibold text-sidebar-foreground" title={buildingName || "BuildFin"}>
              {buildingName || "BuildFin"}
            </span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1 hover:bg-sidebar-accent lg:hidden"
            aria-label={t("Close menu")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label={t("Main menu")}>
          {NAV.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                {t(group.label)}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const fullHref = basePath + item.href
                  const isActive =
                    item.href === "/"
                      ? pathname === basePath || pathname === basePath + "/"
                      : pathname.startsWith(fullHref)
                  const expanded = item.children ? expandedFor(item.href, isActive) : false
                  return (
                    <div key={item.href}>
                      <div className="flex items-center gap-1">
                        <Link
                          href={fullHref}
                          onClick={() => setMobileOpen(false)}
                          aria-current={isActive && !hash ? "page" : undefined}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          )}
                        >
                          <item.icon className="h-5 w-5 shrink-0" />
                          <span className="flex-1 truncate">{t(item.label)}</span>
                        </Link>
                        {item.children && (
                          <button
                            type="button"
                            onClick={() => setExpanded((m) => ({ ...m, [item.href]: !expanded }))}
                            aria-expanded={expanded}
                            aria-label={expanded ? t("Collapse {name}", { name: t(item.label) }) : t("Expand {name}", { name: t(item.label) })}
                            className="rounded-lg p-2 text-sidebar-foreground hover:bg-sidebar-accent"
                          >
                            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                          </button>
                        )}
                      </div>
                      {item.children && expanded && (
                        <ul className="mb-1 ms-6 mt-1 space-y-0.5 border-s border-sidebar-border ps-3">
                          {item.children.map((child) => {
                            const childActive = isActive && hash === child.hash
                            return (
                              <li key={child.hash}>
                                <Link
                                  href={`${fullHref}#${child.hash}`}
                                  onClick={() => {
                                    setMobileOpen(false)
                                    announceHashChange()
                                  }}
                                  aria-current={childActive ? "location" : undefined}
                                  className={cn(
                                    "block rounded-md px-3 py-2 text-sm transition-colors",
                                    childActive
                                      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                  )}
                                >
                                  {t(child.label)}
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer controls */}
        <div className="shrink-0 border-t border-sidebar-border p-4 space-y-1">
          {/* Language toggle — cycles through the available languages */}
          <button
            onClick={() => {
              const idx = LANGUAGES.findIndex((l) => l.value === lang)
              const next = LANGUAGES[(idx + 1) % LANGUAGES.length]
              setLang(next.value)
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
          >
            <Globe className="h-5 w-5 shrink-0" />
            <span className="flex-1 text-start">{t("Language")}</span>
            <span className="text-sidebar-foreground/60">{lang === "ar" ? "العربية" : "English"}</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
          >
            {theme === "dark" ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
            <span className="flex-1 text-start">{theme === "dark" ? t("Light Mode") : t("Dark Mode")}</span>
          </button>

          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-destructive"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className="flex-1 text-start">{t("Sign out")}</span>
          </button>

          <p className="px-3 pt-1 text-[10px] text-muted-foreground">BuildFin {APP_VERSION}</p>
        </div>
      </aside>
    </>
  )
}
