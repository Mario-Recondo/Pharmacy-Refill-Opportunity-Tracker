// Aliased in place of "@tauri-apps/api/core" by vitest.config.ts.
// The data layer's only invoke() is the Rust execute_batch command (ADR 0003);
// emulate its all-or-nothing transaction against the in-memory DB.
import { runBatchInTransaction } from "../helpers/fakeTauri";

export const batchInvocations: { sql: string; params: unknown[] }[][] = [];
export function resetBatchInvocations(): void { batchInvocations.length = 0; }

export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  if (cmd === "execute_batch") {
    const statements = (args?.statements ?? []) as { sql: string; params: unknown[] }[];
    batchInvocations.push(statements);
    runBatchInTransaction(statements);
    return null;
  }
  throw new Error(`invoke("${cmd}") has no test stub`);
}
