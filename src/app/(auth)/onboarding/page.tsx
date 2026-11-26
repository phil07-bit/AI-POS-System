import { redirect } from "next/navigation";
import { NewOrgForm } from "@/components/forms/auth-forms";
import { getCurrentSession } from "@/lib/auth/next";
export const metadata = { title: "Set up organization" };
export default async function Page() {
  if (!(await getCurrentSession())) redirect("/login");
  return <NewOrgForm />;
}
