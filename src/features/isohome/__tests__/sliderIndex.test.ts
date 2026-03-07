import { describe, it, expect } from 'vitest';
import { bucketFromIndex, indexFromBucket } from '../utils/sliderIndex';

describe('bucketFromIndex', () => {
  it('returns 30 for index 0', () => {
    expect(bucketFromIndex(0)).toBe(30);
  });

  it('returns 60 for index 2', () => {
    expect(bucketFromIndex(2)).toBe(60);
  });

  it('returns 120 for index 5', () => {
    expect(bucketFromIndex(5)).toBe(120);
  });

  it('throws RangeError for negative index', () => {
    expect(() => bucketFromIndex(-1)).toThrow(RangeError);
  });

  it('throws RangeError for index out of range', () => {
    expect(() => bucketFromIndex(6)).toThrow(RangeError);
  });
});

describe('indexFromBucket', () => {
  it('returns 0 for bucket 30', () => {
    expect(indexFromBucket(30)).toBe(0);
  });

  it('returns 2 for bucket 60', () => {
    expect(indexFromBucket(60)).toBe(2);
  });

  it('returns 5 for bucket 120', () => {
    expect(indexFromBucket(120)).toBe(5);
  });

  it('throws RangeError for invalid bucket', () => {
    expect(() => indexFromBucket(50)).toThrow(RangeError);
  });
});
