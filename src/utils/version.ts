// Named comparison results — how `a` stands relative to `b` — so call sites read as
// intent, e.g. `compareVersions(stored, floor) === VersionComparisonResult.Older`.
// String-valued on purpose: numeric idioms like `< 0` on the result are a type error, so
// the named form is the only way to branch on it.
export const VersionComparisonResult = {
  Older: 'older',
  Equal: 'equal',
  Newer: 'newer',
} as const;

export type VersionComparisonResult = (typeof VersionComparisonResult)[keyof typeof VersionComparisonResult];

// Compares two dot-separated numeric version strings (e.g. "0.1.0" vs "0.2.0").
// Defensive: if either side fails to parse as a dot-separated sequence of non-negative
// integers, the comparison resolves to Older, so callers gating on "not Older" reject
// invalid input rather than accept it.
export function compareVersions(a: string, b: string): VersionComparisonResult {
  const parse = (value: string): number[] | null => {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const nums = value.split('.').map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    return nums;
  };

  const partsA = parse(a);
  const partsB = parse(b);
  if (partsA === null || partsB === null) return VersionComparisonResult.Older;

  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) {
      return numA < numB ? VersionComparisonResult.Older : VersionComparisonResult.Newer;
    }
  }
  return VersionComparisonResult.Equal;
}
