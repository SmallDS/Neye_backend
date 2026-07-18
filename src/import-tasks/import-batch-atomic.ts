import { ImportTaskStatus } from '@prisma/client';

export class ImportLeaseLostError extends Error {}
export class ImportBatchCanceledError extends Error {}

export interface ImportTaskLeaseSnapshot {
  status: ImportTaskStatus;
  leaseOwner: string | null;
  cancelRequestedAt: Date | null;
}

export function assertImportTaskCanContinue(snapshot: ImportTaskLeaseSnapshot | null, workerId: string) {
  if (snapshot?.status === ImportTaskStatus.canceling || snapshot?.cancelRequestedAt) {
    throw new ImportBatchCanceledError('Import task cancellation was requested');
  }
  if (!snapshot || snapshot.status !== ImportTaskStatus.running || snapshot.leaseOwner !== workerId) {
    throw new ImportLeaseLostError('Import task lease is no longer valid');
  }
}

export function importCompletionWhere(taskId: string, workerId: string) {
  return {
    id: taskId,
    status: ImportTaskStatus.running,
    leaseOwner: workerId,
    cancelRequestedAt: null,
  };
}

export async function executeImportBatchAtomically<TTransaction, TRow, TResult>(
  transaction: (work: (tx: TTransaction) => Promise<void>) => Promise<void>,
  rows: readonly TRow[],
  prepare: (tx: TTransaction) => Promise<void>,
  beforeEach: (tx: TTransaction, row: TRow) => Promise<void>,
  processRow: (tx: TTransaction, row: TRow) => Promise<TResult>,
  finalize: (tx: TTransaction, results: TResult[]) => Promise<void>,
) {
  await transaction(async (tx) => {
    await prepare(tx);
    const results: TResult[] = [];
    for (const row of rows) {
      await beforeEach(tx, row);
      results.push(await processRow(tx, row));
    }
    await finalize(tx, results);
  });
}