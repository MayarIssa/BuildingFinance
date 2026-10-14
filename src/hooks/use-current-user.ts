"use client"

import { useEffect, useState } from "react"
import { fetchCurrentUser, type CurrentUser } from "@/lib/auth-client"

/** Fetches the signed-in user once. */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    let active = true
    fetchCurrentUser().then(({ user }) => {
      if (active) setUser(user)
    })
    return () => {
      active = false
    }
  }, [])

  return user
}
