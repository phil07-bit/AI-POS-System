"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const notFound = /not found/i.test(error.message);
  const forbidden = /permission|forbidden|staff only/i.test(error.message);
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h2 className="font-semibold text-red-800">{notFound ? "Record not found" : forbidden ? "Access denied" : "Something went wrong"}</h2>
      <p className="mt-1 text-sm text-red-700">{notFound ? "It may not exist or may be outside your access scope." : forbidden ? "Your role does not allow this action or page." : "Please try again. If it continues, contact support with the time of the error."}</p>
      <button className="mt-3 rounded border border-red-300 bg-white px-3 py-1 text-sm" onClick={reset}>Try again</button>
    </div>
  );
}
