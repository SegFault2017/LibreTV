/**
 * 分类浏览的「年份」筛选分组：
 * - 近几年逐年展示（从「当前年份 − 5」所在年代的起始年开始，如 2026 → 2020…2026）；
 * - 更早的按年代合并（2010年代、2000年代 …），1970 年以前统一归入「更早」；
 * - 没有可用年份的归入「未知」，排在最后。
 * 这样零星的老片不会把年份行撑成一串断断续续的单独年份。
 */

export interface YearBucket {
  /** 筛选用的唯一键 */
  key: string;
  /** 按钮文案 */
  label: string;
  /** 排序值：越大越靠前 */
  order: number;
}

export const UNKNOWN_BUCKET: YearBucket = { key: 'unknown', label: '未知', order: -1 };
const EARLIER_BUCKET: YearBucket = { key: 'earlier', label: '更早', order: 0 };
/** 早于该年份的影片统一归入「更早」 */
const EARLIEST_DECADE = 1970;

/** 逐年展示的起始年份：「当前年份 − 5」所在年代的第一年 */
export function recentCutoff(currentYear: number): number {
  return Math.floor((currentYear - 5) / 10) * 10;
}

export function yearBucket(rawYear: string | undefined, currentYear: number): YearBucket {
  const y = (rawYear || '').trim();
  if (!/^(19|20)\d{2}$/.test(y)) return UNKNOWN_BUCKET;
  const n = Number(y);
  if (n >= recentCutoff(currentYear)) return { key: y, label: y, order: n };
  if (n < EARLIEST_DECADE) return EARLIER_BUCKET;
  const decade = Math.floor(n / 10) * 10;
  return { key: `${decade}s`, label: `${decade}年代`, order: decade };
}

/**
 * 完整、连续的分组列表（不含「未知」）：当前年份 … 逐年起始年，再到各年代，最后「更早」。
 * 年份行始终展示完整列表，避免只显示已加载影片的年份导致断断续续。
 */
export function allYearBuckets(currentYear: number): YearBucket[] {
  const out: YearBucket[] = [];
  const cutoff = recentCutoff(currentYear);
  for (let y = currentYear; y >= cutoff; y--) out.push({ key: String(y), label: String(y), order: y });
  for (let d = cutoff - 10; d >= EARLIEST_DECADE; d -= 10) {
    out.push({ key: `${d}s`, label: `${d}年代`, order: d });
  }
  out.push(EARLIER_BUCKET);
  return out;
}

/**
 * 年份行实际展示的分组（仍保持连续、不跳年）：
 * - 近年逐年全部展示；
 * - 年代从最近的年代连续往前，只到「有影片的最早年代」为止，尾部全是 0 的不展示；
 * - 「更早」「未知」及未来年份只在有影片时展示；
 * - 当前选中的分组始终展示（及其与近年之间的年代，保持连续）。
 */
export function visibleYearBuckets(
  years: (string | undefined)[],
  currentYear: number,
  selectedKey?: string
): { bucket: YearBucket; count: number }[] {
  const counted = new Map(countYearBuckets(years, currentYear).map((c) => [c.bucket.key, c]));
  const all = allYearBuckets(currentYear).map((bucket) => counted.get(bucket.key) ?? { bucket, count: 0 });
  const cutoff = recentCutoff(currentYear);
  // 需要延伸到的最早年代：有影片或被选中的年代里 order 最小的（「更早」不拉长年代链）
  let floor = cutoff;
  for (const c of all) {
    const isDecade = c.bucket.order < cutoff && c.bucket.key !== 'earlier';
    if (isDecade && (c.count > 0 || c.bucket.key === selectedKey)) floor = Math.min(floor, c.bucket.order);
  }
  const out = all.filter((c) => {
    if (c.bucket.order >= cutoff) return true;
    if (c.bucket.key === 'earlier') return c.count > 0 || c.bucket.key === selectedKey;
    return c.bucket.order >= floor;
  });
  const listed = new Set(out.map((c) => c.bucket.key));
  for (const c of counted.values()) if (!listed.has(c.bucket.key)) out.push(c);
  return out.sort((a, b) => b.bucket.order - a.bucket.order);
}

/** 统计各分组数量，按 order 降序返回 */
export function countYearBuckets(
  years: (string | undefined)[],
  currentYear: number
): { bucket: YearBucket; count: number }[] {
  const map = new Map<string, { bucket: YearBucket; count: number }>();
  for (const raw of years) {
    const bucket = yearBucket(raw, currentYear);
    const entry = map.get(bucket.key);
    if (entry) entry.count++;
    else map.set(bucket.key, { bucket, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.bucket.order - a.bucket.order);
}
