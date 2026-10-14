"use client"

export type CurrentUser = {
  id: string
  email: string
  full_name: string | null
}

type AuthResult = { user: CurrentUser | null; error: string | null }

async function post(path: string, body?: unknown): Promise<AuthResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return { user: null, error: json?.error ?? `HTTP ${res.status}` }
    return { user: json?.user ?? null, error: null }
  } catch (err) {
    return { user: null, error: err instanceof Error ? err.message : "Network error" }
  }
}

export function signIn(email: string, password: string) {
  return post("/api/auth/login", { email, password })
}

export function signUp(data: { email: string; password: string; full_name: string; building_name: string }) {
  return post("/api/auth/signup", data)
}

export async function signOut() {
  await post("/api/auth/logout")
}

/** The signed-in user, null when signed out; status "error" when the server can't be reached */
export async function fetchCurrentUser(): Promise<{ user: CurrentUser | null; status: number }> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" })
    const json = await res.json().catch(() => null)
    return { user: res.ok ? (json?.user ?? null) : null, status: res.status }
  } catch {
    return { user: null, status: 0 }
  }
}
