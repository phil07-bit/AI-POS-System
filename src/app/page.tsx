import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/next";

export default async function Home() {
  const s = await getCurrentSession();
  redirect(s ? "/app" : "/login");
}
