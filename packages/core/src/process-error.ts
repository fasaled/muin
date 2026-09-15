import { MuinError, NotFoundError } from "./errors.ts";

export function formatProcessError(err: unknown): string {
  if (isErrno(err) && err.code === "ENOENT") {
    const path = typeof err.path === "string" ? err.path : "";
    return path ? `file not found: ${path}` : "file not found";
  }
  if (err instanceof MuinError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function wrapIoError(err: unknown, filePath: string): Error {
  if (isErrno(err) && err.code === "ENOENT") {
    return new NotFoundError(`file not found: ${filePath}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function isErrno(err: unknown): err is { code: string; path?: string } {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string";
}
