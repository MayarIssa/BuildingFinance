"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { signIn } from "@/lib/auth-client"
import { AuthCard } from "@/components/auth/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"

export default function LoginPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { user, error } = await signIn(email, password)
    setLoading(false)
    if (!user) {
      toast({ title: "Sign in failed", description: error ?? undefined, variant: "destructive" })
      return
    }
    router.push("/")
  }

  function handleGuestDemo() {
    const session = {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    }
    sessionStorage.setItem("buildfin.guest.session", JSON.stringify(session))
    router.push("/guest")
  }

  return (
    <AuthCard title="Sign in to BuildFin">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-4 space-y-2">
        <Button variant="outline" className="w-full" onClick={handleGuestDemo}>
          Try a 10-minute demo — no sign-up needed
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/auth/signup" className="text-primary hover:underline">Create one</Link>
        </p>
      </div>
    </AuthCard>
  )
}
