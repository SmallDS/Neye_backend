import { ImportTaskPhase, ImportTaskStatus } from '@prisma/client';

export function importPublishWhere(taskId: string, workerId: string) {
  return {
    id: taskId,
    status: ImportTaskStatus.running,
    phase: ImportTaskPhase.processing,
    leaseOwner: workerId,
    cancelRequestedAt: null,
  };
}

export function hiddenImportRecord(taskId: string, hiddenAt: Date) {
  return { importTaskId: taskId, deletedAt: hiddenAt };
}

export function canRequestImportCancellation(status: ImportTaskStatus, phase: ImportTaskPhase) {
  return (
    (status === ImportTaskStatus.pending || status === ImportTaskStatus.running) &&
    phase !== ImportTaskPhase.publishing &&
    phase !== ImportTaskPhase.finished
  );
}
