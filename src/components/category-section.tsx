'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { BrowseCategory, SearchResultItem, SourceConfig } from '@/lib/types';
import { visibleYearBuckets, yearBucket, type YearBucket } from '@/lib/year-buckets';
import { formatRemarks } from '@/lib/remarks';
import { pageItems } from '@/lib/pagination';
import { sortByRating } from '@/lib/rating-sort';

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
  /** 当前页码（源站分页，1 起） */
  const [page, setPage] = useState(1);
  /** 分类区顶部：翻页后滚回这里 */
  const sectionRef = useRef<HTMLElement>(null);
  /** Selected year group (null = all). Filters only the current page. */
  const [year, setYear] = useState<YearBucket | null>(null);
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const source = sources.find((s) => s.key === sourceKey) ?? sources[0];

  // 换源：分类 id 各源不通用，回到「最新」
  useEffect(() => {
    setTopId('');
    setTypeId('');
    setCategories([]);
  }, [source?.key]);

  // 换源 / 换分类：回到第 1 页
  useEffect(() => setPage(1), [source?.key, typeId]);

  const query = useQuery({
    queryKey: ['browse', source?.url, typeId, page, yellowFilter],
    queryFn: ({ signal }) => api.browse(source!, typeId, page, yellowFilter, signal),
    enabled: Boolean(source),
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });

  const responseCategories = query.data?.categories;
  useEffect(() => {
    if (responseCategories) setCategories(responseCategories);
  }, [responseCategories]);

  const pageCount = Math.max(1, query.data?.pageCount ?? 1);

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

  // 同一页内也可能有重复条目，按 vodId 去重
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.list ?? []).filter((it) => (seen.has(it.vodId) ? false : (seen.add(it.vodId), true)));
  }, [query.data]);

  // Switching category, source or page clears the year filter (it only applies to the current page)
  useEffect(() => setYear(null), [typeId, source?.key, page]);

  // Year row: recent years one by one, then decades down to the oldest one with videos (no gaps)
  const yearCounts = useMemo(
    () =>
      visibleYearBuckets(
        items.map((it) => it.year),
        currentYear,
        year?.key
      ),
    [items, currentYear, year?.key]
  );

  /** 排序：源站顺序（最新更新）或本页按评分从高到低；翻页 / 换分类时保持用户的选择 */
  const [sort, setSort] = useState<'latest' | 'rating'>('latest');

  const shown = useMemo(() => {
    const filtered = year ? items.filter((it) => yearBucket(it.year, currentYear).key === year.key) : items;
    return sort === 'rating' ? sortByRating(filtered) : filtered;
  }, [items, year, currentYear, sort]);

  const goToPage = (next: number) => {
    const target = Math.min(Math.max(1, next), pageCount);
    if (target === page) return;
    setPage(target);
    // 滚回分类区顶部（留出顶栏高度），否则换页后停在列表底部
    const top = sectionRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) window.scrollBy({ top: top - 64, behavior: 'smooth' });
  };

  if (!source) return null;

  const loadingFresh = query.isLoading || (query.isPlaceholderData && query.isFetching);

  return (
    <section ref={sectionRef} aria-label="分类浏览" className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 shrink-0">
          <h2 className="text-base font-semibold text-content">分类浏览</h2>
          <div className="flex gap-1.5" role="group" aria-label="排序">
            <Chip small active={sort === 'latest'} onClick={() => setSort('latest')}>
              最新
            </Chip>
            <Chip small active={sort === 'rating'} onClick={() => setSort('rating')}>
              评分
            </Chip>
          </div>
        </div>
        {sources.length > 1 &&
          (sources.length <= 4 ? (
            <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label="选择点播源">
              {sources.map((s) => (
                <Chip key={s.key} small active={s.key === source.key} onClick={() => setSourceKey(s.key)}>
                  {s.name}
                </Chip>
              ))}
            </div>
          ) : (
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
          ))}
      </div>

      {/* 筛选区吸顶（顶栏 h-14 之下）：长列表滚动时随时可切换分类 */}
      <div className="sticky top-14 z-30 -mx-4 px-4 py-2 space-y-2 bg-page/95 backdrop-blur supports-[backdrop-filter]:bg-page/90">
        <div className="filter-row" role="group" aria-label="分类">
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
          <div className="filter-row" role="group" aria-label="子分类">
            {subs.map((c) => (
              <Chip key={c.id} small active={typeId === c.id} onClick={() => setTypeId(c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
        )}

        {!loadingFresh && items.length > 0 && (
          <div className="filter-row items-center" role="group" aria-label="年份">
            <span className="text-xs text-faint shrink-0 mr-0.5">年份</span>
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
      </div>

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
                本页 {items.length} 部中有 {shown.length} 部属于「{year.label}」
                {pageCount > 1 && '，翻页可查看其他影片'}
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5 sm:gap-3">
              {shown.map((item) => (
                <DoubanCard
                  key={`${item.sourceKey}_${item.vodId}`}
                  item={{ title: item.name, cover: item.pic || '', rating: item.rating }}
                  badge={formatRemarks(item.remarks)}
                  year={/^(19|20)\d{2}$/.test(item.year?.trim() ?? '') ? item.year?.trim() : undefined}
                  onClick={() => onOpen(item)}
                />
              ))}
            </div>
          </>
        )}
        {!query.isError && pageCount > 1 && (
          <Pagination page={page} pageCount={pageCount} onChange={goToPage} />
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
  /** 暂无内容（本页没有该年份）：变暗但仍可点 */
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

/** 分页条：桌面端显示页码（1 … 4 5 6 … 120），手机端只显示「5 / 120」 */
function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  const arrow = 'filter-tag filter-tag-sm disabled:opacity-40 disabled:pointer-events-none';
  return (
    <nav className="mt-6 flex items-center justify-center gap-1.5" aria-label="分页">
      <button className={arrow} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ‹ 上一页
      </button>
      <span className="sm:hidden px-2 text-sm text-muted tabular-nums">
        {page} / {pageCount}
      </span>
      <div className="hidden sm:flex items-center gap-1.5">
        {pageItems(page, pageCount).map((item, i) =>
          item === '…' ? (
            <span key={`gap-${i}`} className="px-1 text-faint" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={item}
              className={cn('filter-tag filter-tag-sm min-w-9 justify-center tabular-nums', item === page && 'filter-tag-active')}
              onClick={() => onChange(item)}
              aria-label={`第 ${item} 页`}
              aria-current={item === page ? 'page' : undefined}
            >
              {item}
            </button>
          )
        )}
      </div>
      <button className={arrow} disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        下一页 ›
      </button>
    </nav>
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

