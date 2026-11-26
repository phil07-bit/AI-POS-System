import { ResetForm } from "@/components/forms/auth-forms";
import { Alert } from "@/components/ui";
export const metadata = { title: "Set new password" };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return token ? <ResetForm token={token} /> : <Alert tone="error">This reset link is missing its token.</Alert>;
}
