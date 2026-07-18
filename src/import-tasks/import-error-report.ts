export interface ImportErrorReportRow {
  rowNo: number;
  importCustomerNo: string | null;
  errorMessage: string | null;
}

function formulaSafe(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return /^(?:[\u0000-\u001f\u007f]|\s*[=+\-@])/u.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown) {
  const safe = formulaSafe(value).replace(/"/g, '""');
  return /[",\r\n]/.test(safe) ? `"${safe}"` : safe;
}

export function createImportErrorCsv(rows: readonly ImportErrorReportRow[]) {
  const lines = [
    ['rowNo', 'importCustomerNo', 'errorMessage'],
    ...rows.map((row) => [row.rowNo, row.importCustomerNo, row.errorMessage]),
  ];
  return Buffer.from(`\uFEFF${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');
}