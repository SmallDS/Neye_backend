import { readFileSync } from 'fs';
import { ImportTaskStatus } from '@prisma/client';
import {
  assertImportTaskCanContinue,
  executeImportBatchAtomically,
  importCompletionWhere,
  ImportBatchCanceledError,
} from '../src/import-tasks/import-batch-atomic';

describe('atomic import cancellation contract', () => {
  it('does not use a long-lived SELECT FOR UPDATE task lock', () => {
    const source = readFileSync('src/import-tasks/import-tasks.service.ts', 'utf8');
    expect(source).not.toContain('FOR UPDATE');
  });

  it('checks cancellation before every row and finalizes inside one transaction', async () => {
    const events: string[] = [];
    const guard = jest.fn(async (_tx: { id: string }, row: number) => { events.push(`guard:${row}`); });
    await executeImportBatchAtomically(
      async (work) => { events.push('begin'); await work({ id: 'tx' }); events.push('commit'); },
      [1, 2, 3],
      async () => { events.push('prepare'); },
      guard,
      async (_tx, row) => { events.push(`row:${row}`); return row * 2; },
      async (_tx, results) => { events.push(`finalize:${results.join(',')}`); },
    );
    expect(guard).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      'begin', 'prepare', 'guard:1', 'row:1', 'guard:2', 'row:2', 'guard:3', 'row:3', 'finalize:2,4,6', 'commit',
    ]);
  });

  it('throws a dedicated cancellation error and skips finalization so the transaction rolls back', async () => {
    const processed: number[] = [];
    const finalize = jest.fn();
    await expect(
      executeImportBatchAtomically(
        async (work) => work({}),
        [1, 2, 3],
        async () => undefined,
        async (_tx, row) => {
          if (row === 2) throw new ImportBatchCanceledError('canceled');
        },
        async (_tx, row) => { processed.push(row); return row; },
        finalize,
      ),
    ).rejects.toBeInstanceOf(ImportBatchCanceledError);
    expect(processed).toEqual([1]);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('recognizes cancel state and requires a conditional final commit', () => {
    expect(() =>
      assertImportTaskCanContinue(
        { status: ImportTaskStatus.canceling, leaseOwner: 'worker', cancelRequestedAt: new Date() },
        'worker',
      ),
    ).toThrow(ImportBatchCanceledError);
    expect(importCompletionWhere('task-id', 'worker-id')).toEqual({
      id: 'task-id',
      status: ImportTaskStatus.running,
      leaseOwner: 'worker-id',
      cancelRequestedAt: null,
    });
  });
});