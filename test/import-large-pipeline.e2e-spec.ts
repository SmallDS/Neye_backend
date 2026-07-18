import { readFileSync } from 'fs';
import { ImportTaskPhase, ImportTaskStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  assertImportDimensions,
  importWorksheetDimensionRef,
  loadImportCapabilities,
  planImportBatches,
} from '../src/import-tasks/import-config';
import { createImportErrorCsv } from '../src/import-tasks/import-error-report';
import { canRequestImportCancellation, hiddenImportRecord, importPublishWhere } from '../src/import-tasks/import-workflow';
import { ImportTasksController } from '../src/import-tasks/import-tasks.controller';

describe('large import pipeline contracts', () => {
  it('uses safe defaults and clamps invalid or excessive environment overrides', () => {
    expect(loadImportCapabilities({})).toMatchObject({
      maxFileBytes: 50 * 1024 * 1024,
      maxRows: 50_000,
      maxColumns: 80,
      maxSheets: 10,
      batchSize: 750,
      workerConcurrency: 1,
    });
    expect(loadImportCapabilities({ IMPORT_MAX_ROWS: '999999', IMPORT_BATCH_SIZE: 'bad', IMPORT_WORKER_CONCURRENCY: '8' })).toMatchObject({
      maxRows: 100_000,
      batchSize: 750,
      workerConcurrency: 1,
    });
  });

  it('accepts 30,469 rows and rejects 50,001 rows at the default boundary', () => {
    const capabilities = loadImportCapabilities({});
    expect(() => assertImportDimensions(30_469, 59, capabilities)).not.toThrow();
    expect(() => assertImportDimensions(50_000, 59, capabilities)).not.toThrow();
    expect(() => assertImportDimensions(50_001, 59, capabilities)).toThrow('Import data must not exceed 50000 rows');
  });

  it('uses the original full range so bounded parsing cannot accept a truncated oversized sheet', () => {
    const capabilities = loadImportCapabilities({});
    const assertSheet = (sheet: { '!fullref'?: string; '!ref'?: string }) => {
      const reference = importWorksheetDimensionRef(sheet);
      expect(reference).toBeDefined();
      const range = XLSX.utils.decode_range(reference as string);
      assertImportDimensions(range.e.r - range.s.r, range.e.c - range.s.c + 1, capabilities);
    };

    expect(() => assertSheet({ '!ref': 'A1:BG50001' })).not.toThrow();
    expect(() => assertSheet({ '!ref': 'A1:BG50002', '!fullref': 'A1:BG50002' })).toThrow(
      'Import data must not exceed 50000 rows',
    );
    expect(() => assertSheet({ '!ref': 'A1:BG50002', '!fullref': 'A1:BG60000' })).toThrow(
      'Import data must not exceed 50000 rows',
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['header'], ['1'], ['2'], ['3']]), 'data');
    const bounded = XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }), {
      dense: true,
      sheetRows: 3,
      type: 'buffer',
    });
    const sheet = bounded.Sheets.data;
    expect(sheet?.['!ref']).toBe('A1:A3');
    expect(sheet?.['!fullref']).toBe('A1:A4');

    const source = readFileSync('src/import-tasks/import-tasks.service.ts', 'utf8');
    expect(source).toContain('dense: true');
    expect(source).toContain('sheetRows: IMPORT_CAPABILITIES.maxRows + 2');
    expect(source).toContain('importWorksheetDimensionRef(sheet)');
  });

  it('plans bounded 750-row staging and processing batches', () => {
    const batches = planImportBatches(30_469, 750);
    expect(batches).toHaveLength(41);
    expect(batches[0]).toEqual({ from: 0, to: 750 });
    expect(batches.at(-1)).toEqual({ from: 30_000, to: 30_469 });
  });

  it('marks imported business data hidden and requires a cancellation-free publication transition', () => {
    const hiddenAt = new Date('2026-07-16T00:00:00.000Z');
    expect(hiddenImportRecord('task-1', hiddenAt)).toEqual({ importTaskId: 'task-1', deletedAt: hiddenAt });
    expect(importPublishWhere('task-1', 'worker-1')).toEqual({
      id: 'task-1',
      status: ImportTaskStatus.running,
      phase: ImportTaskPhase.processing,
      leaseOwner: 'worker-1',
      cancelRequestedAt: null,
    });
    expect(canRequestImportCancellation(ImportTaskStatus.running, ImportTaskPhase.processing)).toBe(true);
    expect(canRequestImportCancellation(ImportTaskStatus.running, ImportTaskPhase.publishing)).toBe(false);
  });

  it('creates a UTF-8 BOM CSV with escaping and spreadsheet formula protection', () => {
    const csv = createImportErrorCsv([
      { rowNo: 2, importCustomerNo: '=CMD()', errorMessage: 'bad, "quoted"' },
      { rowNo: 3, importCustomerNo: '+1', errorMessage: '@danger' },
      { rowNo: 4, importCustomerNo: '\t=CMD()', errorMessage: '\r+1' },
      { rowNo: 5, importCustomerNo: '  @SUM(1)', errorMessage: '\u0001control' },
    ]).toString('utf8');
    expect(csv.startsWith('\uFEFFrowNo,importCustomerNo,errorMessage\r\n')).toBe(true);
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain('"bad, ""quoted"""');
    expect(csv).toContain("'+1,'@danger");
    expect(csv).toContain("'\t=CMD()");
    expect(csv).toContain("'\r+1");
    expect(csv).toContain("'  @SUM(1)");
    expect(csv).toContain("'\u0001control");
  });

  it('exposes the runtime capabilities without returning stored source bytes', () => {
    const controller = new ImportTasksController({} as never);
    const capabilities = controller.capabilities();
    expect(capabilities.maxRows).toBe(50_000);
    expect(capabilities).not.toHaveProperty('content');
  });
});