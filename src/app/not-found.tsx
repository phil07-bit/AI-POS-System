import Link from "next/link";
export default function NotFound() {
  return (<main id="main" className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-6 text-center"><h1 className="text-lg font-semibold">Not found</h1><p className="text-sm text-slate-600">This record does not exist or you do not have access to it.</p><Link href="/app" className="text-sm text-brand-700 hover:underline">Back to overview</Link></main>);
}
