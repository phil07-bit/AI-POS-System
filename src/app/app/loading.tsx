export default function Loading() {
  return (<div className="space-y-3" aria-busy="true" aria-live="polite"><span className="sr-only">Loading…</span><div className="h-7 w-48 animate-pulse rounded bg-slate-200" /><div className="grid grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-200" />)}</div><div className="h-64 animate-pulse rounded-lg bg-slate-200" /></div>);
}
