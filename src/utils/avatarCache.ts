/**
 * Profile pictures, done right for TVs.
 *
 * Jellyfin serves user images at full size whatever size is asked (measured: a 5776×3248 phone photo = 6.4 MB
 * JPEG / 795 KB WebP, ~75 MB of RAM once decoded), and its resized/WebP copies drop the EXIF orientation, so
 * phone photos showed sideways.
 *
 * So, once per picture version (the image tag):
 *   1. read the EXIF orientation from the first 128 KB of the original JPEG (the rest is not downloaded),
 *   2. load the lighter WebP, rotate it upright and center-crop it to a 256×256 square on a canvas,
 *   3. keep that ~15 KB thumbnail in localStorage.
 * Every screen then uses the small, upright thumbnail — instantly, even after restarting the app.
 */
import { useEffect, useState } from 'react';

const SIZE = 256;
const PREFIX = 'yudia_avatar:';
const memory = new Map<string, Promise<string | null>>();

/** Parse `/Users/{id}/Images/Primary?…tag=…` → base URL of the original image, user id and tag. */
function parseAvatarUrl(src: string): { original: string; webp: string; key: string; userId: string } | null {
  const m = src.match(/^(.*\/Users\/([^/]+)\/Images\/Primary)(\?.*)?$/i);
  if (!m) return null;
  const tag = new URLSearchParams(m[3] || '').get('tag') || '';
  const tagQ = tag ? `tag=${tag}` : '';
  return {
    original: `${m[1]}${tagQ ? `?${tagQ}` : ''}`,
    webp: `${m[1]}?format=webp${tagQ ? `&${tagQ}` : ''}`,
    key: `${PREFIX}${m[1]}:${tag}`,
    userId: m[2]
  };
}

/** EXIF orientation (1–8) from the start of a JPEG; 1 when absent. Reads at most ~128 KB of the stream. */
async function readOrientation(url: string): Promise<number> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return 1;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    while (got < 131072) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      got += value.length;
    }
    reader.cancel().catch(() => {}); // stop the download: the orientation is in the header
    const b = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      b.set(c.subarray(0, Math.min(c.length, got - o)), o);
      o += c.length;
    }
    const v = new DataView(b.buffer);
    if (v.getUint16(0) !== 0xffd8) return 1; // not a JPEG
    let p = 2;
    while (p + 4 < b.length) {
      const marker = v.getUint16(p);
      const len = v.getUint16(p + 2);
      if (marker === 0xffe1 && String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) === 'Exif') {
        const t = p + 10;
        const le = v.getUint16(t) === 0x4949;
        const ifd = t + v.getUint32(t + 4, le);
        const n = v.getUint16(ifd, le);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
        }
        return 1;
      }
      if ((marker & 0xff00) !== 0xff00) break;
      p += 2 + len;
    }
  } catch {
    /* ignore */
  }
  return 1;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Jellyfin answers Access-Control-Allow-Origin: *, so the canvas stays readable
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function buildThumb(original: string, webp: string): Promise<string | null> {
  const [orientation, img] = await Promise.all([readOrientation(original), loadImage(webp).catch(() => loadImage(original))]);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // WebP copies carry no EXIF, so rotate by hand (square crop → same size for every orientation).
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const side = Math.min(w, h); // center square crop of the stored image
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;

  ctx.translate(SIZE / 2, SIZE / 2);
  switch (orientation) {
    case 2: ctx.scale(-1, 1); break;
    case 3: ctx.rotate(Math.PI); break;
    case 4: ctx.scale(1, -1); break;
    case 5: ctx.rotate(Math.PI / 2); ctx.scale(1, -1); break;
    case 6: ctx.rotate(Math.PI / 2); break;
    case 7: ctx.rotate(-Math.PI / 2); ctx.scale(1, -1); break;
    case 8: ctx.rotate(-Math.PI / 2); break;
  }
  ctx.drawImage(img, sx, sy, side, side, -SIZE / 2, -SIZE / 2, SIZE, SIZE);

  const webpOut = canvas.toDataURL('image/webp', 0.85);
  return webpOut.startsWith('data:image/webp') ? webpOut : canvas.toDataURL('image/jpeg', 0.85);
}

export function getAvatarThumb(src: string): Promise<string | null> {
  const parsed = parseAvatarUrl(src);
  if (!parsed) return Promise.resolve(null);
  try {
    const hit = localStorage.getItem(parsed.key);
    if (hit) return Promise.resolve(hit);
  } catch {
    /* no storage */
  }
  if (!memory.has(parsed.key)) {
    memory.set(
      parsed.key,
      buildThumb(parsed.original, parsed.webp)
        .then((thumb) => {
          if (thumb) {
            try {
              // forget older versions of this user's picture, then store the new one
              for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith(PREFIX) && k.includes(`/Users/${parsed.userId}/`) && k !== parsed.key) localStorage.removeItem(k);
              }
              localStorage.setItem(parsed.key, thumb);
            } catch {
              /* quota: still used for this session */
            }
          }
          return thumb;
        })
        .catch(() => null)
    );
  }
  return memory.get(parsed.key)!;
}

/** Small, upright profile picture for a Jellyfin user image URL (falls back to the URL itself). */
export function useAvatarSrc(src?: string): string | undefined {
  const [thumb, setThumb] = useState<string | null>(() => {
    const parsed = src ? parseAvatarUrl(src) : null;
    try {
      return parsed ? localStorage.getItem(parsed.key) : null;
    } catch {
      return null;
    }
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src || !parseAvatarUrl(src)) return;
    let alive = true;
    getAvatarThumb(src).then((t) => {
      if (!alive) return;
      if (t) setThumb(t);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  if (!src) return undefined;
  if (!parseAvatarUrl(src)) return src; // not a Jellyfin user image
  if (thumb) return thumb;
  return failed ? src : undefined; // while the thumbnail is being made: nothing (no sideways flash)
}
