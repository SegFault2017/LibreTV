import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, isAdultContent, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import type { BrowseCategory, BrowseResponse, SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

/** 分类表很少变化，缓存久一些；列表页按最新更新排序，短缓存即可 */
const CLASS_CACHE_TTL = 10 * 60 * 1000;
const LIST_CACHE_TTL = 2 * 60 * 1000;

function parseSource(raw: string | null): SourceConfig | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as SourceConfig;
    if (!obj || typeof obj.key !== 'string' || !/^https?:\/\//.test(obj.url || '')) return null;
    return obj;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchUpstream(url, { timeoutMs: 10000, headers: cmsRequestHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** ac=list 返回的 class 数组 → 统一分类表 */
function parseClasses(data: unknown): BrowseCategory[] {
  const raw = (data as { class?: unknown })?.class;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const o = c as Record<string, unknown>;
      return {
        id: String(o.type_id ?? ''),
        pid: String(o.type_pid ?? '0'),
        name: String(o.type_name ?? '').trim(),
      };
    })
    .filter((c) => c.id && c.name);
}

/**
 * 分类浏览：按点播源的分类（type_id）拉取最新影片，供首页「分类浏览」使用。
 *
 * GET /api/browse?source=<SourceConfig JSON>&t=<type_id，可省略=全部>&pg=<页码>&filterAdult=1
 * → { categories, list, page, pageCount }
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const url = new URL(req.url);
  const source = parseSource(url.searchParams.get('source'));
  const t = (url.searchParams.get('t') || '').trim();
  const pg = Math.min(10000, Math.max(1, parseInt(url.searchParams.get('pg') || '1', 10) || 1));
  const filterAdult = url.searchParams.get('filterAdult') !== '0';

  if (!source) {
    return NextResponse.json({ error: '无效的点播源配置' }, { status: 400 });
  }
  if (t && !/^\d+$/.test(t)) {
    return NextResponse.json({ error: '无效的分类' }, { status: 400 });
  }

  const verdict = await checkUpstreamAllowed(source.url);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const base = source.url.replace(/\/+$/, '');
  try {
    // 分类表
    const classKey = `browse-class:${base}`;
    let categories = getCache<BrowseCategory[]>(classKey);
    if (!categories) {
      categories = parseClasses(await fetchJson(`${base}?ac=list`));
      setCache(classKey, categories, CLASS_CACHE_TTL);
    }
    if (filterAdult) {
      categories = categories.filter((c) => !isAdultContent(c.name));
    }
    // 过滤模式下禁止直接请求成人分类
    if (t && filterAdult && !categories.some((c) => c.id === t)) {
      return NextResponse.json({ error: '该分类不可用' }, { status: 403 });
    }

    // 影片列表（videolist 才带封面）
    const listKey = `browse-list:${base}|${t}|${pg}`;
    let page = getCache<{ list: BrowseResponse['list']; pageCount: number }>(listKey);
    if (!page) {
      const data = await fetchJson(`${base}?ac=videolist${t ? `&t=${t}` : ''}&pg=${pg}`);
      const rawCount = parseInt(String((data as { pagecount?: unknown })?.pagecount ?? '1'), 10);
      page = {
        list: parseSearchList(data, source),
        pageCount: Number.isFinite(rawCount) ? Math.max(0, rawCount) : 1,
      };
      setCache(listKey, page, LIST_CACHE_TTL);
    }

    const payload: BrowseResponse = {
      categories,
      list: filterAdultResults(page.list, filterAdult),
      page: pg,
      pageCount: page.pageCount,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取分类内容失败' },
      { status: 502 }
    );
  }
}
