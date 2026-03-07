import { describe, it, expect } from 'vitest';
import { formatMinutes } from '../utils/formatTime';

describe('formatMinutes', () => {
  it('formats 30 minutes', () => {
    expect(formatMinutes(30)).toBe('30 min');
  });

  it('formats 45 minutes', () => {
    expect(formatMinutes(45)).toBe('45 min');
  });

  it('formats 60 minutes as 1 hour', () => {
    expect(formatMinutes(60)).toBe('1 hour');
  });

  it('formats 75 minutes', () => {
    expect(formatMinutes(75)).toBe('1 hr 15 min');
  });

  it('formats 90 minutes', () => {
    expect(formatMinutes(90)).toBe('1 hr 30 min');
  });

  it('formats 120 minutes as 2 hours', () => {
    expect(formatMinutes(120)).toBe('2 hours');
  });

  it('formats 15 minutes', () => {
    expect(formatMinutes(15)).toBe('15 min');
  });
});
