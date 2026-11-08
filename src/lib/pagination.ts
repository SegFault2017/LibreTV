/** 分页条上的一项：页码或省略号 */
export type PageItem = number | '…';

/** 页数不超过该值时全部列出；超过时固定 7 个位置（首、尾、当前页附近 + 省略号） */
const MAX_SLOTS = 7;

/**
 * 计算分页条要显示的页码，例如第 50/120 页 → 1 … 49 50 51 … 120。
 * 位置数固定，翻页时分页条宽度不跳动；越界的当前页会被夹到有效范围内。
 */
export function pageItems(current: number, total: number): PageItem[] {
  const last = Math.max(1, Math.floor(total) || 1);
  const page = Math.min(Math.max(1, Math.floor(current) || 1), last);
  if (last <= MAX_SLOTS) return Array.from({ length: last }, (_, i) => i + 1);

  let pages: number[];
  if (page <= 4) pages = [1, 2, 3, 4, 5, last];
  else if (page >= last - 3) pages = [1, last - 4, last - 3, last - 2, last - 1, last];
  else pages = [1, page - 1, page, page + 1, last];

  const out: PageItem[] = [];
  for (const p of pages) {
    const prev = out[out.length - 1];
    if (typeof prev === 'number' && p - prev > 1) out.push('…');
    out.push(p);
  }
  return out;
}
