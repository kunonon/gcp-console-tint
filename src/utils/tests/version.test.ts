import { describe, expect, it } from 'vitest';
import { compareVersions, VersionComparisonResult } from '../version';

const { Older, Equal, Newer } = VersionComparisonResult;

describe('compareVersions', () => {
  it('returns Equal for equal versions', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(Equal);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(Equal);
  });

  it('returns Older when a is lower than b', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(Older);
    expect(compareVersions('0.1.0', '1.0.0')).toBe(Older);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(Older);
  });

  it('returns Newer when a is higher than b', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(Newer);
    expect(compareVersions('9.9.9', '0.1.0')).toBe(Newer);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(Newer);
  });

  it('treats missing trailing components as 0 when part counts differ', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(Equal);
    expect(compareVersions('1.0.0', '1.0')).toBe(Equal);
    expect(compareVersions('1.2', '1.2.1')).toBe(Older);
    expect(compareVersions('1.2.1', '1.2')).toBe(Newer);
  });

  it('compares numerically, not lexicographically, for multi-digit segments', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(Newer);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(Older);
  });

  it('treats an invalid a as Older than a valid b', () => {
    expect(compareVersions('not-a-version', '0.1.0')).toBe(Older);
    expect(compareVersions('', '0.1.0')).toBe(Older);
    expect(compareVersions('1.x.0', '0.1.0')).toBe(Older);
  });

  it('returns Older when b is invalid, regardless of a', () => {
    expect(compareVersions('0.1.0', 'not-a-version')).toBe(Older);
    expect(compareVersions('9.9.9', '')).toBe(Older);
  });

  it('returns Older when both sides are invalid', () => {
    expect(compareVersions('abc', 'xyz')).toBe(Older);
  });

  it('treats a negative segment as invalid (resolves to Older), regardless of which side it is on', () => {
    expect(compareVersions('1.-1.0', '0.1.0')).toBe(Older);
    expect(compareVersions('0.1.0', '1.-1.0')).toBe(Older);
    expect(compareVersions('-1.0.0', '0.0.0')).toBe(Older);
  });

  it('compares segments beyond the third, treating a missing trailing segment as 0', () => {
    expect(compareVersions('1.2.3.4', '1.2.3')).toBe(Newer);
    expect(compareVersions('1.2.3', '1.2.3.4')).toBe(Older);
    expect(compareVersions('1.2.3.0', '1.2.3')).toBe(Equal);
  });
});
