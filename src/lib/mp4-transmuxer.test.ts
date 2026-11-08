import { describe, expect, it } from 'vitest';
import { patchInitSegmentDuration, renumberFragments } from './mp4-transmuxer';

const u32 = (v: number) =>
  new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);

const readU32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const payloadLen = payloads.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + payloadLen);
  out.set(u32(out.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let off = 8;
  for (const p of payloads) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** version 0 full box：version(1)+flags(3)=0，其后是若干 u32 字段 */
function fullBox(fields: number[]): Uint8Array {
  const out = new Uint8Array(4 + fields.length * 4);
  fields.forEach((v, i) => out.set(u32(v), 4 + i * 4));
  return out;
}

/** 按 mux.js 的实际布局搭最小 initSegment：ftyp + moov(mvhd + trak(tkhd)) */
function initSegment(mvhdDuration: number, tkhdDuration: number): Uint8Array {
  const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d]));
  const mvhdBox = box('mvhd', fullBox([0, 0, 90_000, mvhdDuration])); // timescale 90000
  const tkhdBox = box('tkhd', fullBox([0, 0, 1, 0, tkhdDuration]));
  const moov = box('moov', mvhdBox, box('trak', tkhdBox));
  const out = new Uint8Array(ftyp.length + moov.length);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  return out;
}

// ftyp(12) + moov 头(8) → mvhd 头(8) → mvhd payload 起点 28
const MVHD_PAYLOAD = 12 + 8 + 8;
// + mvhd payload(20) + trak 头(8) + tkhd 头(8) → tkhd payload 起点 64
const TKHD_PAYLOAD = MVHD_PAYLOAD + 20 + 8 + 8;

describe('patchInitSegmentDuration', () => {
  it('把 mvhd/tkhd 的 0xFFFFFFFF 哨兵值替换为真实时长（90000 时基）', () => {
    const patched = patchInitSegmentDuration(initSegment(0xffffffff, 0xffffffff), 2730);
    expect(readU32(patched, MVHD_PAYLOAD + 16)).toBe(2730 * 90_000);
    expect(readU32(patched, TKHD_PAYLOAD + 20)).toBe(2730 * 90_000);
  });

  it('0xFFFFFFFF/90000 ≈ 47721.86s ≈ 13:15:21 —— 未修补时播放器看到的时长', () => {
    expect(0xffffffff / 90_000).toBeCloseTo(47721.86, 1);
  });

  it('时长非正数 / 非有限值时原样返回', () => {
    const init = initSegment(0xffffffff, 0xffffffff);
    expect(patchInitSegmentDuration(init, 0)).toEqual(init);
    expect(patchInitSegmentDuration(init, Number.NaN)).toEqual(init);
  });

  it('不修改入参缓冲', () => {
    const init = initSegment(0xffffffff, 0xffffffff);
    patchInitSegmentDuration(init, 60);
    expect(readU32(init, MVHD_PAYLOAD + 16)).toBe(0xffffffff);
  });
});

/** 带 mdia/mdhd 的 initSegment：ftyp + moov(mvhd + trak(tkhd + mdia(mdhd))) */
function initWithMdhd(mdhdTimescale: number, mdhdDuration: number): Uint8Array {
  const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d]));
  const mvhdBox = box('mvhd', fullBox([0, 0, 90_000, 0xffffffff]));
  const tkhdBox = box('tkhd', fullBox([0, 0, 1, 0, 0xffffffff]));
  const mdhdBox = box('mdhd', fullBox([0, 0, mdhdTimescale, mdhdDuration]));
  const moov = box('moov', mvhdBox, box('trak', tkhdBox, box('mdia', mdhdBox)));
  const out = new Uint8Array(ftyp.length + moov.length);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  return out;
}
// tkhd payload(24) 之后：mdia 头(8) + mdhd 头(8)
const MDHD_PAYLOAD = TKHD_PAYLOAD + 24 + 8 + 8;

describe('patchInitSegmentDuration · mdhd（QuickTime 兼容）', () => {
  it('mdhd 的「未知时长」哨兵清零：否则 QuickTime 按 0xFFFFFFFF/44100 ≈ 27 小时计时长', () => {
    const patched = patchInitSegmentDuration(initWithMdhd(44_100, 0xffffffff), 60);
    expect(readU32(patched, MDHD_PAYLOAD + 12)).toBe(44_100); // timescale 不动
    expect(readU32(patched, MDHD_PAYLOAD + 16)).toBe(0);
  });

  it('时长未知时 mvhd/tkhd 保持原样，但 mdhd 哨兵仍清零', () => {
    const patched = patchInitSegmentDuration(initWithMdhd(90_000, 0xffffffff), Number.NaN);
    expect(readU32(patched, MVHD_PAYLOAD + 16)).toBe(0xffffffff);
    expect(readU32(patched, MDHD_PAYLOAD + 16)).toBe(0);
  });

  it('mdhd 已有真实时长时不改写', () => {
    const patched = patchInitSegmentDuration(initWithMdhd(90_000, 12345), 60);
    expect(readU32(patched, MDHD_PAYLOAD + 16)).toBe(12345);
  });
});

/** moof(mfhd(seq) + traf) + mdat，与 mux.js 每轨一个 moof 的产物布局一致 */
function fragment(seq: number): Uint8Array {
  const mfhd = box('mfhd', fullBox([seq]));
  const traf = box('traf', box('tfhd', fullBox([1])));
  const moof = box('moof', mfhd, traf);
  const mdat = box('mdat', new Uint8Array([1, 2, 3, 4]));
  const out = new Uint8Array(moof.length + mdat.length);
  out.set(moof, 0);
  out.set(mdat, moof.length);
  return out;
}
function concatAll(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function sequences(buf: Uint8Array): number[] {
  const seqs: number[] = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const size = readU32(buf, off);
    const type = String.fromCharCode(...buf.slice(off + 4, off + 8));
    // moof 头(8) + mfhd 头(8) + version/flags(4) → 序号
    if (type === 'moof') seqs.push(readU32(buf, off + 8 + 8 + 4));
    off += size;
  }
  return seqs;
}

describe('renumberFragments', () => {
  it('mux.js 每次 flush 的音视频 moof 序号相同且从 0 起：改写为从 1 严格递增', () => {
    // 两次 flush，每次音视频各一个 moof：0,0 / 1,1（QuickTime 会丢弃重复序号的分片 → 视频轨为空）
    const flush1 = concatAll(fragment(0), fragment(0));
    const flush2 = concatAll(fragment(1), fragment(1));
    let next = renumberFragments(flush1, 1);
    next = renumberFragments(flush2, next);
    expect(sequences(flush1)).toEqual([1, 2]);
    expect(sequences(flush2)).toEqual([3, 4]);
    expect(next).toBe(5);
  });

  it('不含 moof 的数据原样返回序号', () => {
    const mdatOnly = box('mdat', new Uint8Array([9]));
    expect(renumberFragments(mdatOnly, 7)).toBe(7);
  });
});
