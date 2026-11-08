'use client';

import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { BrowseCategory, SearchResultItem, SourceConfig } from '@/lib/types';
import { allYearBuckets, countYearBuckets, yearBucket, type YearBucket } from '@/lib/year-buckets';

/** 选中的年份在已加载影片中一部都没有时，最多自动翻几页去找 */
const MAX_AUTO_PAGES = 5;
import { DoubanCard } from './video-card';

/**
 * 首页「分类浏览」：按点播源自带的分类（Apple CMS type）展示最新影片。
 * - 顶部一行：最新 + 顶级分类；选中有子分类的顶级分类时，第二行列出子分类
 *   （多数源只把影片挂在子分类下，父分类本身常常是空的，因此默认选中第一个子分类）
 * - 点击卡片直接打开详情弹窗（与搜索结果一致），无需再搜索一次
 */
export function CategorySection({
  sources,
  onOpen,
}: {
  sources: SourceConfig[];
  onOpen: (item: SearchResultItem) => void;
}) {
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const [sourceKey, setSourceKey] = useState<string>('');
  /** 选中的顶级分类 id；'' = 最新（全部分类） */
  const [topId, setTopId] = useState('');
  /** 实际请求的分类 id（顶级本身或其子分类） */
  const [typeId, setTypeId] = useState('');
  /** 分类表：每次响应都带回，单独保存以免切换分类加载时 chips 闪烁 */
  const [categories, setCategories] = useState<BrowseCategory[]>([]);
  /** Selected year group (null = all). Filters only the pages loaded so far. */
  const [year, setYear] = useState<YearBucket | null>(null);
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const source = sources.find((s) => s.key === sourceKey) ?? sources[0];

  // 换源：分类 id 各源不通用，回到「最新」
  useEffect(() => {
    setTopId('');
    setTypeId('');
    setCategories([]);
  }, [source?.key]);

  const query = useInfiniteQuery({
    queryKey: ['browse', source?.url, typeId, yellowFilter],
    queryFn: ({ pageParam, signal }) => api.browse(source!, typeId, pageParam, yellowFilter, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pageCount ? last.page + 1 : undefined),
    enabled: Boolean(source),
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });

  const firstCategories = query.data?.pages[0]?.categories;
  useEffect(() => {
    if (firstCategories) setCategories(firstCategories);
  }, [firstCategories]);

  const { tops, childrenOf } = useMemo(() => {
    const ids = new Set(categories.map((c) => c.id));
    const childrenOf = new Map<string, BrowseCategory[]>();
    const tops: BrowseCategory[] = [];
    for (const c of categories) {
      // 父分类不存在（或被成人过滤掉）时，把它当作顶级分类展示
      if (c.pid === '0' || !ids.has(c.pid)) tops.push(c);
      else childrenOf.set(c.pid, [...(childrenOf.get(c.pid) ?? []), c]);
    }
    return { tops, childrenOf };
  }, [categories]);

  const subs = topId ? childrenOf.get(topId) ?? [] : [];

  const pickTop = (id: string) => {
    setTopId(id);
    setTypeId(id ? childrenOf.get(id)?.[0]?.id ?? id : '');
  };

  // 同一影片可能出现在相邻两页（源站翻页期间有更新），按 vodId 去重
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? [])
      .flatMap((p) => p.list)
      .filter((it) => (seen.has(it.vodId) ? false : (seen.add(it.vodId), true)));
  }, [query.data]);

  // Switching category or source clears the year filter
  useEffect(() => setYear(null), [typeId, source?.key]);

  // Continuous year row: every recent year and every decade, with counts from the loaded items
  // (0 = none loaded yet). Extra groups (未知 / future years) are added only when present.
  const yearCounts = useMemo(() => {
    const counted = new Map(
      countYearBuckets(
        items.map((it) => it.year),
        currentYear
      ).map((c) => [c.bucket.key, c])
    );
    const list = allYearBuckets(currentYear).map((bucket) => counted.get(bucket.key) ?? { bucket, count: 0 });
    const listed = new Set(list.map((c) => c.bucket.key));
    for (const c of counted.values()) if (!listed.has(c.bucket.key)) list.push(c);
    return list.sort((a, b) => b.bucket.order - a.bucket.order);
  }, [items, currentYear]);

  const shown = useMemo(
    () => (year ? items.filter((it) => yearBucket(it.year, currentYear).key === year.key) : items),
    [items, year, currentYear]
  );

  // A year with nothing loaded yet: fetch a few more pages automatically to look for it
  const [autoPages, setAutoPages] = useState(0);
  useEffect(() => setAutoPages(0), [year?.key, typeId, source?.key]);
  const autoSearching =
    Boolean(year) && shown.length === 0 && Boolean(query.hasNextPage) && autoPages < MAX_AUTO_PAGES;
  const { fetchNextPage, isFetching } = query;
  useEffect(() => {
    if (!autoSearching || isFetching) return;
    setAutoPages((n) => n + 1);
    fetchNextPage();
  }, [autoSearching, isFetching, fetchNextPage]);

  if (!source) return null;

  const loadingFresh = query.isLoading || (query.isPlaceholderData && query.isFetching);

  return (
    <section aria-label="分类浏览" className="mb-10">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold text-content">分类浏览</h2>
        {sources.length > 1 && (
          <select
            className="bg-chip text-sm text-content rounded-lg px-2 py-1 border border-line focus:outline-none focus:border-accent"
            value={source.key}
            onChange={(e) => setSourceKey(e.target.value)}
            aria-label="选择点播源"
          >
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap gap-2 sm:gap-2.5 mb-2">
        <Chip active={topId === ''} onClick={() => pickTop('')}>
          最新
        </Chip>
        {tops.map((c) => (
          <Chip key={c.id} active={topId === c.id} onClick={() => pickTop(c.id)}>
            {c.name}
          </Chip>
        ))}
      </div>

      {subs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 pl-2 border-l-2 border-line">
          {subs.map((c) => (
            <Chip key={c.id} small active={typeId === c.id} onClick={() => setTypeId(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
      )}

      {!loadingFresh && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-xs text-faint mr-1">年份</span>
          <Chip small active={year === null} onClick={() => setYear(null)}>
            全部
          </Chip>
          {yearCounts.map(({ bucket, count }) => (
            <Chip
              key={bucket.key}
              small
              dim={count === 0}
              active={year?.key === bucket.key}
              onClick={() => setYear(bucket)}
            >
              {bucket.label} <span className="opacity-60">{count}</span>
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-4">
        {query.isError ? (
          <p className="text-center text-sm text-faint py-8">
            分类内容加载失败：{query.error instanceof Error ? query.error.message : '请求失败'}
          </p>
        ) : loadingFresh ? (
          <GridSkeleton />
        ) : shown.length === 0 && !year ? (
          <p className="text-center text-sm text-faint py-8">该分类暂无内容</p>
        ) : (
          <>
            {year && (
              <p className="text-xs text-faint mb-2">
                已加载 {items.length} 部中有 {shown.length} 部属于「{year.label}」
                {autoSearching
                  ? '，正在加载更多…'
                  : query.hasNextPage && '，点「加载更多」可找到更多'}
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
              {shown.map((item) => (
                <DoubanCard
                  key={`${item.sourceKey}_${item.vodId}`}
                  item={{ title: item.name, cover: item.pic || '' }}
                  onClick={() => onOpen(item)}
                />
              ))}
            </div>
            {query.hasNextPage && (
              <div className="flex justify-center mt-4">
                <button
                  className="btn-ghost btn-sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? '加载中…' : '加载更多'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Chip({
  active,
  small,
  dim,
  onClick,
  children,
}: {
  active: boolean;
  small?: boolean;
  /** 暂无内容（已加载影片中没有该年份）：变暗但仍可点，点了会自动加载更多 */
  dim?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        'filter-tag',
        small && 'filter-tag-sm',
        active && 'filter-tag-active',
        dim && !active && 'opacity-50'
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
          <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

