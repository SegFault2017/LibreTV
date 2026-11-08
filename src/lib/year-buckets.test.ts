import { describe, expect, it } from 'vitest';
import { allYearBuckets, countYearBuckets, recentCutoff, yearBucket } from './year-buckets';

describe('allYearBuckets', () => {
  it('连续列出近年、各年代与「更早」', () => {
    expect(allYearBuckets(2026).map((b) => b.label)).toEqual([
      '2026', '2025', '2024', '2023', '2022', '2021', '2020',
      '2010年代', '2000年代', '1990年代', '1980年代', '1970年代', '更早',
    ]);
  });

  it('与 yearBucket 的分组一致', () => {
    const keys = new Set(allYearBuckets(2026).map((b) => b.key));
    for (let y = 1950; y <= 2026; y++) expect(keys.has(yearBucket(String(y), 2026).key)).toBe(true);
  });
});

describe('recentCutoff', () => {
  it('取「当前年份 − 5」所在年代的起始年', () => {
    expect(recentCutoff(2026)).toBe(2020);
    expect(recentCutoff(2025)).toBe(2020);
    expect(recentCutoff(2024)).toBe(2010);
    expect(recentCutoff(2030)).toBe(2020);
  });
});

describe('yearBucket', () => {
  it('近几年逐年展示', () => {
    expect(yearBucket('2026', 2026)).toMatchObject({ key: '2026', label: '2026' });
    expect(yearBucket('2020', 2026)).toMatchObject({ key: '2020', label: '2020' });
  });

  it('更早的按年代合并', () => {
    expect(yearBucket('2019', 2026)).toMatchObject({ key: '2010s', label: '2010年代' });
    expect(yearBucket('2010', 2026)).toMatchObject({ key: '2010s', label: '2010年代' });
    expect(yearBucket('1976', 2026)).toMatchObject({ key: '1970s', label: '1970年代' });
  });

  it('1970 年以前归入「更早」', () => {
    expect(yearBucket('1969', 2026)).toMatchObject({ key: 'earlier', label: '更早' });
    expect(yearBucket('1931', 2026)).toMatchObject({ key: 'earlier' });
  });

  it('无效年份归入「未知」', () => {
    expect(yearBucket('', 2026).key).toBe('unknown');
    expect(yearBucket(undefined, 2026).key).toBe('unknown');
    expect(yearBucket('0', 2026).key).toBe('unknown');
    expect(yearBucket('2023年', 2026).key).toBe('unknown');
    expect(yearBucket(' 2023 ', 2026).key).toBe('2023');
  });
});

describe('countYearBuckets', () => {
  it('计数并按新到旧排序，更早、未知排最后', () => {
    const years = ['2026', '2026', '2023', '1976', '1975', '1971', '1960', '', '2015'];
    const result = countYearBuckets(years, 2026).map(({ bucket, count }) => [bucket.label, count]);
    expect(result).toEqual([
      ['2026', 2],
      ['2023', 1],
      ['2010年代', 1],
      ['1970年代', 3],
      ['更早', 1],
      ['未知', 1],
    ]);
  });
});
