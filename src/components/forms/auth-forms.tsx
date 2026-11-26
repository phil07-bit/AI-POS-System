"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const { pending, error, run } = useSubmit();
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => api<{ hasMembership: boolean; isTenant: boolean }>("/auth/login", { body: { email, password } }));
      if (r) { router.push(r.isTenant ? "/portal" : r.hasMembership ? "/app" : "/onboarding"); router.refresh(); }
    }}>
      <h2 className="text-base font-semibold">Sign in</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">Forgot password?</Link>
        <Link href="/signup" className="text-brand-700 hover:underline">Create a workspace</Link>
      </div>
      {demo && (
        <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Demo mode.</strong> Seeded accounts (local demo only, not for production): <code>owner@caxaze.demo</code>, <code>manager@caxaze.demo</code>, <code>finance@caxaze.demo</code>, <code>tech@caxaze.demo</code>, <code>tenant@caxaze.demo</code> — password <code>DemoPass2026!</code>
        </div>
      )}
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [f, setF] = useState({ fullName: "", email: "", password: "", organizationName: "" });
  const { pending, error, fe, run } = useSubmit();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("/auth/signup", { body: f }))) { router.push("/app/settings?welcome=1"); router.refresh(); } }}>
      <h2 className="text-base font-semibold">Create your workspace</h2>
      <p className="text-sm text-slate-600">You will be the organization owner. Defaults: Ghana, GHS, Africa/Accra — change them in Settings.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Your full name" htmlFor="fullName" error={fe("fullName")} required><Input id="fullName" autoComplete="name" value={f.fullName} onChange={set("fullName")} required /></Field>
      <Field label="Work email" htmlFor="email" error={fe("email")} required><Input id="email" type="email" autoComplete="email" value={f.email} onChange={set("email")} required /></Field>
      <Field label="Password" htmlFor="password" error={fe("password")} hint="At least 10 characters, letters and numbers." required><Input id="password" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} required /></Field>
      <Field label="Organization / business name" htmlFor="org" error={fe("organizationName")} required><Input id="org" value={f.organizationName} onChange={set("organizationName")} required placeholder="e.g. Asante Property Management" /></Field>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</Button>
      <p className="text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Already have an account? Sign in</Link></p>
    </form>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState<string | null>(null);
  const { pending, error, run } = useSubmit();
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api<{ message: string }>("/auth/forgot-password", { body: { email } })); if (r) setSent(r.message); }}>
      <h2 className="text-base font-semibold">Reset password</h2>
      {sent ? <Alert tone="success">{sent}</Alert> : null}
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Email" htmlFor="email"><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Button type="submit" className="w-full" disabled={pending}>Send reset link</Button>
      <p className="text-xs text-slate-500">Email is in <strong>mock mode</strong>: no email is actually sent. In demo mode, open <Link className="underline" href="/dev/outbox">the simulated outbox</Link> to view the link.</p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const { pending, error, fe, run } = useSubmit();
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("/auth/reset-password", { body: { token, password } }))) router.push("/login?reset=1"); }}>
      <h2 className="text-base font-semibold">Choose a new password</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="New password" htmlFor="password" error={fe("password")} hint="At least 10 characters, letters and numbers."><Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Button type="submit" className="w-full" disabled={pending}>Set password</Button>
    </form>
  );
}

export function AcceptInviteForm({ token, email, orgName, roleName, userExists }: { token: string; email: string; orgName: string; roleName: string; userExists: boolean }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(""); const [password, setPassword] = useState("");
  const { pending, error, fe, run } = useSubmit();
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("/invitations/accept", { body: { token, fullName, password } }))) { router.push(roleName === "Tenant Portal User" ? "/portal" : "/app"); router.refresh(); } }}>
      <h2 className="text-base font-semibold">Join {orgName}</h2>
      <p className="text-sm text-slate-600">You were invited as <strong>{roleName}</strong> ({email}).</p>
      {error && <Alert tone="error">{error}</Alert>}
      {!userExists && <Field label="Full name" htmlFor="fullName" error={fe("fullName")}><Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>}
      <Field label={userExists ? "Your existing password" : "Create a password"} htmlFor="password" error={fe("password")} hint={userExists ? undefined : "At least 10 characters, letters and numbers."}>
        <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>Accept invitation</Button>
    </form>
  );
}

export function NewOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const { pending, error, run } = useSubmit();
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const org = await run(() => api<{ id: string }>("/organizations", { body: { name } }));
      if (org) { await api("/auth/switch-organization", { body: { organizationId: org.id } }); router.push("/app/settings?welcome=1"); router.refresh(); }
    }}>
      <h2 className="text-base font-semibold">Set up your organization</h2>
      <p className="text-sm text-slate-600">Your account is not a member of any active organization. Create one, or ask an administrator for an invitation.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Organization name" htmlFor="name"><Input id="name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Button type="submit" className="w-full" disabled={pending}>Create organization</Button>
    </form>
  );
}
