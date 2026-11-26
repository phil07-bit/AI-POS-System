import "server-only";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/api/errors";

/** Map service authorization/existence errors to proper page responses (404 / redirect). */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "VALIDATION_ERROR")) notFound();
    if (e instanceof AppError && e.code === "FORBIDDEN") redirect("/app?denied=1");
    throw e;
  }
}
