// Compares two dot-separated numeric version strings (e.g. "0.1.0" vs "0.2.0").
// Returns -1 if a < b, 0 if a === b, 1 if a > b.
// Defensive: if either side fails to parse as a dot-separated sequence of non-negative
// integers, the comparison is resolved as -1 so callers using
// `compareVersions(x, threshold) >= 0` reject invalid input rather than accept it.
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] | null => {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const nums = value.split('.').map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    return nums;
  };

  const partsA = parse(a);
  const partsB = parse(b);
  if (partsA === null || partsB === null) return -1;

  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) return numA < numB ? -1 : 1;
  }
  return 0;
}
