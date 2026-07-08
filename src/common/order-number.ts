export function createOrderNo(prefix: string): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
    String(now.getMilliseconds()).padStart(3, '0'),
  ].join('');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${stamp}${suffix}`;
}