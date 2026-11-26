import { LoginForm } from "@/components/forms/auth-forms";
import { Alert } from "@/components/ui";

export const metadata = { title: "Sign in" };
export default async function Page({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const sp = await searchParams;
  return (<>{sp.reset && <div className="mb-3"><Alert tone="success">Password updated. Sign in with your new password.</Alert></div>}<LoginForm demo={process.env.DEMO_MODE === "true"} /></>);
}
