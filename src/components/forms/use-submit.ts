"use client";
import { useState } from "react";
import { ApiError } from "@/lib/client/api";

/** Shared submit state: pending flag, top-level error, per-field errors from VALIDATION_ERROR details. */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setPending(true); setError(null); setFieldErrors({});
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const fe: Record<string, string> = {};
        for (const d of e.details) if (d.path && !fe[d.path]) fe[d.path] = d.message;
        setFieldErrors(fe);
      } else setError("Something went wrong. Please try again.");
      return undefined;
    } finally {
      setPending(false);
    }
  }
  const fe = (path: string) => fieldErrors[path] ?? Object.entries(fieldErrors).find(([k]) => k.startsWith(path + "."))?.[1];
  return { pending, error, fieldErrors, fe, run, setError };
}
