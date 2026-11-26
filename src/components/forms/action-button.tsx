"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert, Textarea } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

/**
 * POSTs to an API endpoint, optionally behind a confirmation dialog with a required reason.
 * Used for archive / activate / confirm / reverse / terminate style actions.
 */
export function ActionButton({
  endpoint, body = {}, label, variant = "secondary", confirm, reasonLabel, reasonField = "reason", successMessage, redirectTo, extraFields,
}: {
  endpoint: string; body?: Record<string, unknown>; label: string; variant?: "primary" | "secondary" | "danger" | "ghost";
  confirm?: { title: string; body: string; confirmLabel?: string }; reasonLabel?: string; reasonField?: string; successMessage?: string; redirectTo?: string;
  extraFields?: { name: string; label: string; type: "date" | "text"; defaultValue?: string; required?: boolean }[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [extras, setExtras] = useState<Record<string, string>>(Object.fromEntries((extraFields ?? []).map((f) => [f.name, f.defaultValue ?? ""])));
  const [done, setDone] = useState<string | null>(null);
  const { pending, error, run } = useSubmit();

  async function execute() {
    const payload = { ...body, ...(reasonLabel ? { [reasonField]: reason } : {}), ...extras };
    const res = await run(() => api(endpoint, { method: "POST", body: payload }));
    if (res !== undefined) {
      dialog.current?.close();
      setDone(successMessage ?? "Done.");
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    }
  }

  return (
    <>
      <Button type="button" variant={variant} disabled={pending} onClick={() => (confirm ? dialog.current?.showModal() : execute())}>
        {pending ? "Working…" : label}
      </Button>
      {done && !confirm && <span className="sr-only" role="status">{done}</span>}
      {!confirm && error && <span className="text-xs text-red-600" role="alert">{error}</span>}
      {confirm && (
        <dialog ref={dialog} className="w-full max-w-md rounded-lg p-0 shadow-xl backdrop:bg-slate-900/40" aria-labelledby={`dlg-${label}`}>
          <form method="dialog" onSubmit={(e) => { e.preventDefault(); execute(); }} className="space-y-4 p-5">
            <h2 id={`dlg-${label}`} className="text-base font-semibold">{confirm.title}</h2>
            <p className="text-sm text-slate-600">{confirm.body}</p>
            {extraFields?.map((f) => (
              <div key={f.name}>
                <label htmlFor={`x-${f.name}`} className="mb-1 block text-sm font-medium">{f.label}</label>
                <input id={`x-${f.name}`} type={f.type} required={f.required} value={extras[f.name]} onChange={(e) => setExtras({ ...extras, [f.name]: e.target.value })} className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
            ))}
            {reasonLabel && (
              <div>
                <label htmlFor={`reason-${label}`} className="mb-1 block text-sm font-medium">{reasonLabel}</label>
                <Textarea id={`reason-${label}`} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Cancel</Button>
              <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} disabled={pending}>{pending ? "Working…" : confirm.confirmLabel ?? label}</Button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
