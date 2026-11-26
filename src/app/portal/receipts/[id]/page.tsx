import { orNotFound } from "@/lib/auth/page-guards";
import Link from "next/link";
import { getPageContext } from "@/lib/auth/next";
import { portalReceipt } from "@/server/services/portal.service";
import { ReceiptView } from "@/components/receipt/receipt-view";
import { PrintButton } from "@/components/receipt/print-button";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await orNotFound(portalReceipt(await getPageContext(), id));
  return (<div><div className="no-print mb-4 flex justify-between"><Link href="/portal" className="text-sm text-brand-700 hover:underline">← Back</Link><PrintButton /></div><ReceiptView r={r} /></div>);
}
