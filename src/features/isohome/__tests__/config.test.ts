import { describe, it, expect } from 'vitest';
import { LONDON_TERMINI, TIME_BUCKETS } from '../config';

describe('config', () => {
  describe('LONDON_TERMINI', () => {
    it('has 10 entries', () => {
      expect(LONDON_TERMINI).toHaveLength(10);
    });

    it('all CRS codes are 3 uppercase characters', () => {
      for (const terminus of LONDON_TERMINI) {
        expect(terminus.crs).toMatch(/^[A-Z]{3}$/);
      }
    });

    it('all entries have name and crs', () => {
      for (const terminus of LONDON_TERMINI) {
        expect(terminus.crs).toBeDefined();
        expect(terminus.name).toBeDefined();
        expect(terminus.name.length).toBeGreaterThan(0);
      }
    });

    it("includes King's Cross as KGX", () => {
      const kgx = LONDON_TERMINI.find((t) => t.crs === 'KGX');
      expect(kgx).toBeDefined();
      expect(kgx!.name).toBe("King's Cross");
    });
  });

  describe('TIME_BUCKETS', () => {
    it('has 6 entries', () => {
      expect(TIME_BUCKETS).toHaveLength(6);
    });

    it('contains expected values in order', () => {
      expect([...TIME_BUCKETS]).toEqual([30, 45, 60, 75, 90, 120]);
    });

    it('all values are positive numbers', () => {
      for (const bucket of TIME_BUCKETS) {
        expect(bucket).toBeGreaterThan(0);
      }
    });
  });
});
