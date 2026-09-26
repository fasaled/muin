import { LimitError } from "./errors.ts";

export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
/** qpdf JSON of the object graph (no stream bodies). Often larger than the PDF. */
export const DEFAULT_MAX_JSON_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_OBJECTS = 200_000;
export const EXPORT_DEFAULT_DEPTH = 2;
export const EXPORT_MAX_DEPTH = 8;
export const EXPORT_MAX_NODES = 5_000;
export const TREE_DEFAULT_DEPTH = 3;
/** Cap on raw stream bytes returned as base64 text over MCP, to keep agent context bounded. */
export const MCP_STREAM_MAX_BYTES = 2 * 1024 * 1024;
/** Text preview cap for stream/cat output shown in a UI. Generous: the TUI pages through it. */
export const TEXT_PREVIEW_MAX_CHARS = 500_000;
/** Hex dump cap for binary stream previews — beyond this, a byte-for-byte hex view isn't useful reading. */
export const BINARY_PREVIEW_MAX_BYTES = 8 * 1024;
/** Per-event result preview cap in the observation journal. The journal is append-per-operation, so previews stay small; the follower's own session holds full output. */
export const JOURNAL_PREVIEW_MAX_CHARS = 4_000;

export function assertFileSize(byteLength: number, maxBytes = DEFAULT_MAX_BYTES): void {
  if (byteLength > maxBytes) {
    throw new LimitError(
      `PDF is ${byteLength} bytes, which exceeds the limit of ${maxBytes} bytes`,
    );
  }
}

export function assertObjectCount(count: number, max = DEFAULT_MAX_OBJECTS): void {
  if (count > max) {
    throw new LimitError(`PDF has ${count} objects, which exceeds the limit of ${max}`);
  }
}

export function assertJsonSize(byteLength: number, max = DEFAULT_MAX_JSON_BYTES): void {
  if (byteLength > max) {
    throw new LimitError(
      `PDF structure JSON is ${byteLength} bytes (object graph, no stream bodies), which exceeds the limit of ${max} bytes`,
    );
  }
}

export function clampExportDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new LimitError(`export depth must be a non-negative integer, got ${depth}`);
  }
  if (depth > EXPORT_MAX_DEPTH) {
    throw new LimitError(`export depth ${depth} exceeds max ${EXPORT_MAX_DEPTH}`);
  }
  return depth;
}

export function assertExportNodeCount(count: number): void {
  if (count > EXPORT_MAX_NODES) {
    throw new LimitError(`export would include ${count} nodes, max is ${EXPORT_MAX_NODES}`);
  }
}
