export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="inline-grid h-10 w-10 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">AI</span>
          <h1 className="mt-2 text-lg font-semibold">AI-POS</h1>
          <p className="text-sm text-slate-600">Property operations for landlords and managers in Ghana</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
