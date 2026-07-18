export interface ImportCapabilities {
  maxFileBytes: number;
  maxRows: number;
  maxColumns: number;
  maxSheets: number;
  batchSize: number;
  workerConcurrency: number;
}

const DEFAULTS: ImportCapabilities = {
  maxFileBytes: 50 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 80,
  maxSheets: 10,
  batchSize: 750,
  workerConcurrency: 1,
};

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function loadImportCapabilities(env: NodeJS.ProcessEnv = process.env): ImportCapabilities {
  return {
    maxFileBytes: boundedInteger(env.IMPORT_MAX_FILE_BYTES, DEFAULTS.maxFileBytes, 1024 * 1024, 100 * 1024 * 1024),
    maxRows: boundedInteger(env.IMPORT_MAX_ROWS, DEFAULTS.maxRows, 1_000, 100_000),
    maxColumns: boundedInteger(env.IMPORT_MAX_COLUMNS, DEFAULTS.maxColumns, 10, 200),
    maxSheets: boundedInteger(env.IMPORT_MAX_SHEETS, DEFAULTS.maxSheets, 1, 20),
    batchSize: boundedInteger(env.IMPORT_BATCH_SIZE, DEFAULTS.batchSize, 100, 2_000),
    workerConcurrency: boundedInteger(env.IMPORT_WORKER_CONCURRENCY, DEFAULTS.workerConcurrency, 1, 1),
  };
}

export function assertImportDimensions(rowCount: number, columnCount: number, capabilities: ImportCapabilities) {
  if (rowCount > capabilities.maxRows) {
    throw new RangeError(`Import data must not exceed ${capabilities.maxRows} rows`);
  }
  if (columnCount > capabilities.maxColumns) {
    throw new RangeError(`Import data must not exceed ${capabilities.maxColumns} columns`);
  }
}

export function planImportBatches(totalRows: number, batchSize: number) {
  const batches: Array<{ from: number; to: number }> = [];
  for (let from = 0; from < totalRows; from += batchSize) {
    batches.push({ from, to: Math.min(totalRows, from + batchSize) });
  }
  return batches;
}

export interface ImportWorksheetRange {
  '!fullref'?: string;
  '!ref'?: string;
}

export function importWorksheetDimensionRef(sheet: ImportWorksheetRange) {
  return sheet['!fullref'] || sheet['!ref'];
}