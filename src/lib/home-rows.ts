import type { SearchResultItem } from './types';

/**
 * 首页「继续观看」「我的片单」两行的纯逻辑（不依赖 IndexedDB，便于单测）。
 */

/** 观看历史中与「继续观看」相关的字段（与 db.ts HistoryEntry 对齐） */
export interface ContinueSource {
  sourceKey: string;
  vodId: string;
  title: string;
  pic?: string;
  episodeIndex: number;
  totalEpisodes: number;
  playbackPosition: number;
  duration: number;
  timestamp: number;
}

export const CONTINUE_LIMIT = 12;
/** 看到这个比例算「这一集看完了」 */
const FINISHED_RATIO = 0.95;

/** 当前这一集的观看进度（0-1）；没有可用时长时为 0 */
export function episodeProgress(entry: Pick<ContinueSource, 'playbackPosition' | 'duration'>): number {
  if (!(entry.duration > 0) || !(entry.playbackPosition > 0)) return 0;
  return Math.min(1, entry.playbackPosition / entry.duration);
}

/** 整部片是否已看完：最后一集（或单集影片）且进度达到 95% */
export function isFullyWatched(entry: ContinueSource): boolean {
  const lastEpisode = entry.totalEpisodes <= 1 || entry.episodeIndex >= entry.totalEpisodes - 1;
  return lastEpisode && episodeProgress(entry) >= FINISHED_RATIO;
}

/** 继续观看列表：按最近观看排序，去掉已看完的，最多 CONTINUE_LIMIT 条 */
export function continueWatchingItems<T extends ContinueSource>(history: T[], limit = CONTINUE_LIMIT): T[] {
  return [...history]
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((h) => !isFullyWatched(h))
    .slice(0, limit);
}

/** 卡片上的进度文案：剧集显示「第 N 集」，单集影片显示剩余分钟 */
export function continueLabel(entry: ContinueSource): string {
  if (entry.totalEpisodes > 1) {
    return `第 ${entry.episodeIndex + 1}/${entry.totalEpisodes} 集`;
  }
  if (entry.duration > 0 && entry.playbackPosition > 0) {
    const left = Math.max(1, Math.round((entry.duration - entry.playbackPosition) / 60));
    return `剩余 ${left} 分钟`;
  }
  return '继续观看';
}

// —— 我的片单 ——

export interface WatchlistEntry {
  /** 主键：`${sourceKey}_${vodId}` */
  id: string;
  sourceKey: string;
  sourceName: string;
  sourceUrl?: string;
  vodId: string;
  name: string;
  pic?: string;
  typeName?: string;
  year?: string;
  remarks?: string;
  addedAt: number;
}

export function watchlistId(sourceKey: string, vodId: string): string {
  return `${sourceKey}_${vodId}`;
}

export function watchlistEntryFromItem(item: SearchResultItem, now = Date.now()): WatchlistEntry {
  return {
    id: watchlistId(item.sourceKey, item.vodId),
    sourceKey: item.sourceKey,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    vodId: item.vodId,
    name: item.name,
    pic: item.pic,
    typeName: item.typeName,
    year: item.year,
    remarks: item.remarks,
    addedAt: now,
  };
}

/** 片单条目还原成搜索结果条目，直接交给详情弹窗打开 */
export function itemFromWatchlistEntry(entry: WatchlistEntry): SearchResultItem {
  return {
    sourceKey: entry.sourceKey,
    sourceName: entry.sourceName,
    sourceUrl: entry.sourceUrl,
    vodId: entry.vodId,
    name: entry.name,
    pic: entry.pic,
    typeName: entry.typeName,
    year: entry.year,
    remarks: entry.remarks,
  };
}

/** 导入配置时校验片单条目，脏数据丢弃 */
export function sanitizeWatchlist(raw: unknown): WatchlistEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchlistEntry[] = [];
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const sourceKey = str(o.sourceKey);
    const vodId = o.vodId == null ? undefined : String(o.vodId);
    const name = str(o.name);
    if (!sourceKey || !vodId || !name) continue;
    out.push({
      id: watchlistId(sourceKey, vodId),
      sourceKey,
      sourceName: str(o.sourceName) ?? sourceKey,
      sourceUrl: str(o.sourceUrl),
      vodId,
      name,
      pic: str(o.pic),
      typeName: str(o.typeName),
      year: str(o.year),
      remarks: str(o.remarks),
      addedAt: typeof o.addedAt === 'number' ? o.addedAt : Date.now(),
    });
  }
  return out;
}
