import { orNotFound } from "@/lib/auth/page-guards";
import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { getReceipt } from "@/server/services/payment.service";
import { ReceiptView } from "@/components/receipt/receipt-view";
import { PrintButton } from "@/components/receipt/print-button";

export const metadata = { title: "Receipt" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const r = await orNotFound(getReceipt(ctx, id));
  return (
    <div>
      <div className="no-print mb-4 flex justify-between"><Link href={`/app/payments/${id}`} className="text-sm text-brand-700 hover:underline">← Back to payment</Link><PrintButton /></div>
      <ReceiptView r={r} />
    </div>
  );
}
