'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  addToWatchlist,
  removeFromWatchlist,
  removeHistory,
  upsertHistory,
  MAX_HISTORY,
  type HistoryEntry,
  type WatchlistEntry,
} from '@/lib/db';
import {
  continueLabel,
  continueWatchingItems,
  episodeProgress,
  itemFromWatchlistEntry,
  watchlistEntryFromItem,
  watchlistId,
} from '@/lib/home-rows';
import { formatRemarks } from '@/lib/remarks';
import { resolveSource, useAppStore } from '@/lib/store';
import type { SearchResultItem } from '@/lib/types';
import { buildWatchUrl, cn } from '@/lib/utils';
import { SmartImage } from './smart-image';
import { useToast } from './toast';

/**
 * 首页个人化的两行：
 * - 继续观看：观看历史里没看完的，点一下直接回到上次的集数与进度；
 * - 我的片单：在详情弹窗里点「收藏」加入，点一下打开详情。
 * 数据都在本机 IndexedDB，没有内容时整行不显示。
 */

export function ContinueWatchingRow() {
  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(MAX_HISTORY).toArray(), []);
  const items = history ? continueWatchingItems(history) : [];
  if (items.length === 0) return null;

  return (
    <PosterRow title="继续观看" label="继续观看">
      {items.map((item) => (
        <ContinueCard key={item.id} item={item} />
      ))}
    </PosterRow>
  );
}

export function WatchlistRow({ onOpen }: { onOpen: (item: SearchResultItem) => void }) {
  const list = useLiveQuery(() => db.watchlist.orderBy('addedAt').reverse().toArray(), []);
  if (!list || list.length === 0) return null;

  return (
    <PosterRow title="我的片单" label="我的片单" count={list.length}>
      {list.map((entry) => (
        <WatchlistCard key={entry.id} entry={entry} onOpen={onOpen} />
      ))}
    </PosterRow>
  );
}

/** 详情弹窗里的收藏开关 */
export function WatchlistButton({ item }: { item: SearchResultItem }) {
  const id = watchlistId(item.sourceKey, item.vodId);
  // undefined = 查询中；null = 未收藏
  const saved = useLiveQuery(async () => (await db.watchlist.get(id)) ?? null, [id]);
  const { toast } = useToast();
  if (saved === undefined) return null;

  const toggle = () => {
    if (saved) {
      void removeFromWatchlist(id).then(() => toast('已从片单移除', 'info'));
    } else {
      void addToWatchlist(watchlistEntryFromItem(item)).then(() => toast('已加入我的片单', 'success'));
    }
  };

  return (
    <button
      className={cn(
        'btn-sm shrink-0',
        saved ? 'btn-primary' : 'btn-ghost'
      )}
      onClick={toggle}
      aria-pressed={Boolean(saved)}
      title={saved ? '从我的片单移除' : '加入我的片单，首页可快速找到'}
    >
      <HeartIcon filled={Boolean(saved)} />
      {saved ? '已收藏' : '收藏'}
    </button>
  );
}

// —— 内部组件 ——

function PosterRow({
  title,
  label,
  count,
  children,
}: {
  title: string;
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="mb-8">
      <h2 className="mb-3 text-base font-semibold text-content">
        {title}
        {count != null && <span className="ml-1.5 text-sm font-normal text-faint">{count}</span>}
      </h2>
      {/* 单行横滑：不论多少条都只占一行高度 */}
      <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-2 sm:gap-3 snap-x scrollbar-thin">{children}</ul>
    </section>
  );
}

function ContinueCard({ item }: { item: HistoryEntry }) {
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const { toast } = useToast();
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);
  const progress = episodeProgress(item);

  const href = buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    index: item.episodeIndex,
    title: item.title,
    sourceUrl: source?.url ?? item.sourceUrl,
    detail: source?.detail,
  });

  const remove = () => {
    void removeHistory(item.sourceKey, item.vodId).then(() =>
      toast('已从继续观看中移除', 'info', {
        action: {
          label: '撤销',
          // upsertHistory 会按 sourceKey+vodId 重新生成 id，原样写回即可
          onClick: () => void upsertHistory(item),
        },
      })
    );
  };

  return (
    <RowCard
      pic={item.pic}
      title={item.title}
      progress={progress}
      overlay={continueLabel(item)}
      onRemove={remove}
      removeLabel={`从继续观看中移除「${item.title}」`}
    >
      {(content) => (
        <Link href={href} className="block focus-visible:outline-none" aria-label={`继续观看 ${item.title}`}>
          {content}
        </Link>
      )}
    </RowCard>
  );
}

function WatchlistCard({ entry, onOpen }: { entry: WatchlistEntry; onOpen: (item: SearchResultItem) => void }) {
  const { toast } = useToast();
  const remove = () => {
    void removeFromWatchlist(entry.id).then(() =>
      toast('已从片单移除', 'info', {
        action: { label: '撤销', onClick: () => void addToWatchlist(entry) },
      })
    );
  };

  return (
    <RowCard
      pic={entry.pic}
      title={entry.name}
      overlay={formatRemarks(entry.remarks)}
      onRemove={remove}
      removeLabel={`从片单移除「${entry.name}」`}
    >
      {(content) => (
        <button
          type="button"
          className="block w-full text-left focus-visible:outline-none"
          onClick={() => onOpen(itemFromWatchlistEntry(entry))}
          aria-label={`打开 ${entry.name} 详情`}
        >
          {content}
        </button>
      )}
    </RowCard>
  );
}

/** 横滑行里的单张海报卡：外层可点（链接或按钮），右上角悬停出现移除按钮 */
function RowCard({
  pic,
  title,
  overlay,
  progress,
  onRemove,
  removeLabel,
  children,
}: {
  pic?: string;
  title: string;
  overlay?: string;
  progress?: number;
  onRemove: () => void;
  removeLabel: string;
  children: (content: ReactNode) => ReactNode;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);

  const content = (
    <>
      <div className="relative aspect-[2/3] overflow-hidden bg-chip">
        {pic && !imgFailed ? (
          <SmartImage
            url={pic}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onExhausted={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-faint text-xs">暂无封面</div>
        )}
        {overlay && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-1.5 pb-1.5 pt-6 text-[11px] font-medium leading-tight text-white truncate">
            {overlay}
          </div>
        )}
        {progress != null && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20" aria-hidden>
            <div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="text-xs font-medium leading-snug text-content line-clamp-2 min-h-[2.75em]" title={title}>
          {title}
        </div>
      </div>
    </>
  );

  return (
    <li className="card group relative w-28 shrink-0 snap-start sm:w-32 hover:border-accent/50 focus-within:ring-2 focus-within:ring-accent/40">
      {children(content)}
      <button
        type="button"
        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white/90 opacity-100 transition-opacity hover:bg-black/80 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
        aria-label={removeLabel}
        title="移除（可撤销）"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
      />
    </svg>
  );
}
