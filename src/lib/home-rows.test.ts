import { describe, expect, it } from 'vitest';
import {
  continueLabel,
  continueWatchingItems,
  episodeProgress,
  isFullyWatched,
  itemFromWatchlistEntry,
  sanitizeWatchlist,
  watchlistEntryFromItem,
  type ContinueSource,
} from './home-rows';

const h = (over: Partial<ContinueSource>): ContinueSource => ({
  sourceKey: 's',
  vodId: '1',
  title: 't',
  episodeIndex: 0,
  totalEpisodes: 10,
  playbackPosition: 100,
  duration: 1000,
  timestamp: 0,
  ...over,
});

describe('episodeProgress', () => {
  it('按位置/时长计算，缺数据为 0，上限 1', () => {
    expect(episodeProgress({ playbackPosition: 250, duration: 1000 })).toBe(0.25);
    expect(episodeProgress({ playbackPosition: 0, duration: 1000 })).toBe(0);
    expect(episodeProgress({ playbackPosition: 100, duration: 0 })).toBe(0);
    expect(episodeProgress({ playbackPosition: 1200, duration: 1000 })).toBe(1);
  });
});

describe('isFullyWatched', () => {
  it('最后一集看到 95% 才算看完', () => {
    expect(isFullyWatched(h({ episodeIndex: 9, playbackPosition: 960 }))).toBe(true);
    expect(isFullyWatched(h({ episodeIndex: 9, playbackPosition: 500 }))).toBe(false);
    // 中间某集看完不算整部看完：下一集还要继续
    expect(isFullyWatched(h({ episodeIndex: 3, playbackPosition: 990 }))).toBe(false);
  });

  it('单集影片看到 95% 算看完', () => {
    expect(isFullyWatched(h({ totalEpisodes: 1, playbackPosition: 980 }))).toBe(true);
    expect(isFullyWatched(h({ totalEpisodes: 0, playbackPosition: 980 }))).toBe(true);
    expect(isFullyWatched(h({ totalEpisodes: 1, playbackPosition: 100 }))).toBe(false);
  });
});

describe('continueWatchingItems', () => {
  it('按最近观看排序、去掉看完的、限制条数', () => {
    const list = [
      h({ vodId: 'a', timestamp: 1 }),
      h({ vodId: 'b', timestamp: 3, totalEpisodes: 1, playbackPosition: 990 }), // 看完
      h({ vodId: 'c', timestamp: 2 }),
      h({ vodId: 'd', timestamp: 4 }),
    ];
    expect(continueWatchingItems(list).map((x) => x.vodId)).toEqual(['d', 'c', 'a']);
    expect(continueWatchingItems(list, 2).map((x) => x.vodId)).toEqual(['d', 'c']);
  });
});

describe('continueLabel', () => {
  it('剧集显示集数，电影显示剩余分钟', () => {
    expect(continueLabel(h({ episodeIndex: 2, totalEpisodes: 24 }))).toBe('第 3/24 集');
    expect(continueLabel(h({ totalEpisodes: 1, playbackPosition: 600, duration: 6000 }))).toBe('剩余 90 分钟');
    expect(continueLabel(h({ totalEpisodes: 1, playbackPosition: 0, duration: 0 }))).toBe('继续观看');
  });
});

describe('watchlist 条目转换', () => {
  const item = {
    sourceKey: 'env_0',
    sourceName: '光速资源',
    sourceUrl: 'https://x/api.php/provide/vod',
    vodId: '42',
    name: '庆余年',
    pic: 'https://x/p.jpg',
    year: '2019',
    remarks: '全46集',
  };

  it('往返转换保持字段', () => {
    const entry = watchlistEntryFromItem(item, 123);
    expect(entry.id).toBe('env_0_42');
    expect(entry.addedAt).toBe(123);
    expect(itemFromWatchlistEntry(entry)).toMatchObject(item);
  });

  it('导入时丢弃脏数据并补全 id', () => {
    const result = sanitizeWatchlist([
      { sourceKey: 'env_0', vodId: 42, name: '庆余年', addedAt: 5 },
      { sourceKey: '', vodId: '1', name: 'x' },
      { sourceKey: 's', name: 'no id' },
      null,
      'junk',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'env_0_42', vodId: '42', sourceName: 'env_0', addedAt: 5 });
    expect(sanitizeWatchlist('nope')).toEqual([]);
  });
});
