import { describe, expect, it } from 'vitest';
import { sortByRating } from './rating-sort';

describe('sortByRating', () => {
  const item = (name: string, rating?: string) => ({ name, rating });

  it('按评分从高到低，未评分排在最后', () => {
    const list = [item('a', '6.0'), item('b'), item('c', '9.1'), item('d', '7.5')];
    expect(sortByRating(list).map((i) => i.name)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('同分与未评分之间保持原有顺序（源站的最新顺序）', () => {
    const list = [item('a', '8.0'), item('b'), item('c', '8.0'), item('d')];
    expect(sortByRating(list).map((i) => i.name)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('不修改原数组', () => {
    const list = [item('a', '1.0'), item('b', '2.0')];
    sortByRating(list);
    expect(list.map((i) => i.name)).toEqual(['a', 'b']);
  });
});
