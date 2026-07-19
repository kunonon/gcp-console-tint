import { describe, expect, it } from 'vitest';
import { compareVersions } from './version';

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns -1 when a is lower than b', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.1.0', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
  });

  it('returns 1 when a is higher than b', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('9.9.9', '0.1.0')).toBe(1);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
  });

  it('treats missing trailing components as 0 when part counts differ', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBe(-1);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });

  it('compares numerically, not lexicographically, for multi-digit segments', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
  });

  it('treats an invalid a as lower than a valid b', () => {
    expect(compareVersions('not-a-version', '0.1.0')).toBe(-1);
    expect(compareVersions('', '0.1.0')).toBe(-1);
    expect(compareVersions('1.x.0', '0.1.0')).toBe(-1);
  });

  it('returns -1 when b is invalid, regardless of a', () => {
    expect(compareVersions('0.1.0', 'not-a-version')).toBe(-1);
    expect(compareVersions('9.9.9', '')).toBe(-1);
  });

  it('returns -1 when both sides are invalid', () => {
    expect(compareVersions('abc', 'xyz')).toBe(-1);
  });

  it('treats a negative segment as invalid (resolves to -1), regardless of which side it is on', () => {
    expect(compareVersions('1.-1.0', '0.1.0')).toBe(-1);
    expect(compareVersions('0.1.0', '1.-1.0')).toBe(-1);
    expect(compareVersions('-1.0.0', '0.0.0')).toBe(-1);
  });

  it('compares segments beyond the third, treating a missing trailing segment as 0', () => {
    expect(compareVersions('1.2.3.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3.4')).toBe(-1);
    expect(compareVersions('1.2.3.0', '1.2.3')).toBe(0);
  });
});
