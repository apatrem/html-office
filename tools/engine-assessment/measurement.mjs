export function serialiseRows(columns, rows) {
  const allRows = [columns, ...rows];
  const quote = value => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const address = column => {
    let name = '';
    for (let n = column + 1; n; n = Math.floor((n - 1) / 26))
      name = String.fromCharCode(65 + (n - 1) % 26) + name;
    return name;
  };
  return {
    csv: allRows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n',
    json: JSON.stringify(Object.fromEntries(allRows.flatMap((row, r) =>
      row.map((value, c) => [address(c) + (r + 1), {value}]))))
  };
}

// Raw bytes/tokens/hashes should reproduce. Compression can change with Node's
// zlib/Brotli build, so retain it as evidence without making it a CI baseline.
export function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['environment', 'gzipBytes', 'brotliBytes'].includes(key))
    .map(([key, item]) => [key, comparable(item)]));
  return value;
}
