import { TIME_BUCKETS } from '../config';

export function bucketFromIndex(index: number): number {
  if (index < 0 || index >= TIME_BUCKETS.length) {
    throw new RangeError(
      `Slider index ${index} out of range [0, ${TIME_BUCKETS.length - 1}]`,
    );
  }
  return TIME_BUCKETS[index];
}

export function indexFromBucket(bucket: number): number {
  const idx = TIME_BUCKETS.indexOf(bucket as (typeof TIME_BUCKETS)[number]);
  if (idx === -1) throw new RangeError(`${bucket} is not a valid time bucket`);
  return idx;
}
