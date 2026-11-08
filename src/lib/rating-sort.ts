/**
 * 按评分从高到低排序（分类浏览「评分」排序用）。
 * 未评分的排在最后；同分及未评分之间保持原有顺序（即源站的「最新更新」顺序）。
 * 返回新数组，不修改入参。
 */
export function sortByRating<T extends { rating?: string }>(items: T[]): T[] {
  const score = (item: T) => {
    const n = Number(item.rating);
    return Number.isFinite(n) && n > 0 ? n : -1;
  };
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
