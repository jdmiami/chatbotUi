/**
 * Taking a drawing away: a flattened PNG, a layered PSD (each layer its own, via ag-psd, MIT), and a
 * time-lapse of every picture the machine sent back, recorded in the browser (MediaRecorder, WebM or
 * MP4). Where a browser can't record, the time-lapse comes as a zip of its frames instead.
 */
import { drawCover, loadImage, makeCanvas } from './render';

/** The bytes and type of a data URL. */
export function dataUrlBytes(url: string): { bytes: Uint8Array; type: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return { bytes: new Uint8Array(), type: 'application/octet-stream' };
  const type = m[1] || 'text/plain';
  if (!m[2]) return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), type };
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type };
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
export const extOf = (type: string) => EXT[type] ?? 'bin';

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip of files, stored as they are (pictures are already compressed). */
export function zipStore(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.bytes.length, true);
    lv.setUint32(22, f.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, f.bytes.length, true);
    dv.setUint32(24, f.bytes.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);
    parts.push(local, f.bytes);
    central.push(dir);
    offset += local.length + f.bytes.length;
  }
  const dirSize = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of all) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

/** Save a file to the device. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function canvasBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), type, quality));
}

export interface PsdLayer {
  name: string;
  canvas: HTMLCanvasElement;
  opacity?: number;
  hidden?: boolean;
}

/** A layered PSD (bottom layer first) with the flattened picture as its preview. */
export async function layeredPsd(side: number, layers: PsdLayer[], flat: HTMLCanvasElement): Promise<Blob> {
  const { writePsd } = await import('ag-psd');
  const buf = writePsd(
    {
      width: side,
      height: side,
      canvas: flat,
      children: layers.map((l) => ({ name: l.name, canvas: l.canvas, top: 0, left: 0, opacity: l.opacity ?? 1, hidden: Boolean(l.hidden) })),
    },
    { generateThumbnail: true },
  );
  return new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
}

const RECORD_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** The first video type this browser can record, or null. */
export function recordType(MR: { isTypeSupported?: (t: string) => boolean } | undefined = typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined): string | null {
  if (!MR) return null;
  return RECORD_TYPES.find((t) => MR.isTypeSupported?.(t)) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A time-lapse of the pictures, oldest first, ending on `last` (the flattened drawing) held a moment.
 * A video when the browser can record one; otherwise a zip of the frames.
 */
export async function timelapse(images: string[], last: HTMLCanvasElement | null, opts: { side?: number; frameMs?: number; holdMs?: number } = {}): Promise<{ blob: Blob; name: string }> {
  const side = opts.side ?? 768;
  const type = recordType();
  const canvas = makeCanvas(side);
  const can = Boolean(type && typeof (canvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream === 'function');
  if (!can) {
    const files = images.map((src, i) => {
      const { bytes, type: t } = dataUrlBytes(src);
      return { name: `frame-${String(i + 1).padStart(4, '0')}.${extOf(t)}`, bytes };
    });
    if (last) files.push({ name: `frame-${String(files.length + 1).padStart(4, '0')}.png`, bytes: dataUrlBytes(last.toDataURL('image/png')).bytes });
    return { blob: new Blob([zipStore(files) as BlobPart], { type: 'application/zip' }), name: `live-draw-${stamp()}-frames.zip` };
  }
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, side, side);
  const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: type!, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(200);
  for (const src of images) {
    try {
      drawCover(ctx, await loadImage(src), side);
    } catch {
      /* a picture that can't be read is skipped */
    }
    await sleep(opts.frameMs ?? 180);
  }
  if (last) {
    ctx.drawImage(last, 0, 0, side, side);
    await sleep(opts.holdMs ?? 1200);
  }
  rec.stop();
  await stopped;
  for (const t of stream.getTracks()) t.stop();
  const base = type!.split(';')[0];
  return { blob: new Blob(chunks, { type: base }), name: `live-draw-${stamp()}.${base === 'video/mp4' ? 'mp4' : 'webm'}` };
}
