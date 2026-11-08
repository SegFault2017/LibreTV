import { describe, expect, it } from 'vitest';
import { pageItems } from './pagination';

describe('pageItems', () => {
  it('总页数少时全部列出', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('当前页在开头：首页附近 + 省略 + 末页', () => {
    expect(pageItems(1, 120)).toEqual([1, 2, 3, 4, 5, '…', 120]);
    expect(pageItems(3, 120)).toEqual([1, 2, 3, 4, 5, '…', 120]);
  });

  it('当前页在中间：两侧各留一页，两头省略', () => {
    expect(pageItems(50, 120)).toEqual([1, '…', 49, 50, 51, '…', 120]);
  });

  it('当前页在末尾：首页 + 省略 + 末尾附近', () => {
    expect(pageItems(120, 120)).toEqual([1, '…', 116, 117, 118, 119, 120]);
    expect(pageItems(118, 120)).toEqual([1, '…', 116, 117, 118, 119, 120]);
  });

  it('总页数刚超过 7 时也保持 7 个位置', () => {
    expect(pageItems(5, 9)).toEqual([1, '…', 4, 5, 6, '…', 9]);
    expect(pageItems(4, 8)).toEqual([1, 2, 3, 4, 5, '…', 8]);
    expect(pageItems(5, 8)).toEqual([1, '…', 4, 5, 6, 7, 8]);
  });

  it('越界的当前页被夹到有效范围；总页数无效时按 1 页', () => {
    expect(pageItems(0, 3)).toEqual([1, 2, 3]);
    expect(pageItems(99, 3)).toEqual([1, 2, 3]);
    expect(pageItems(1, 0)).toEqual([1]);
  });
});
