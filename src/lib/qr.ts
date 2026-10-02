import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import makeQr from 'qrcode-generator';
import { FRIEND_LINK_BASE } from './config';
import { uid } from './format';

// Everything here is plain JavaScript (no native modules), so it ships as an over-the-air update.

const CODE_RE = /^[2-9A-HJKMNP-Z]{8}$/;

export function friendLink(code: string) {
  return FRIEND_LINK_BASE + code;
}

/**
 * The friend code inside a scanned QR, or null if it isn't one of ours. Accepts the web link
 * (https://<site>/add/CODE) and the app link (motopms://add-friend/CODE).
 */
export function parseFriendCode(text: string): string | null {
  const t = text.trim();
  const web = FRIEND_LINK_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m =
    t.match(new RegExp(`^${web}([A-Za-z0-9]{8})/?$`, 'i')) ?? t.match(/^motopms:\/\/add-friend\/([A-Za-z0-9]{8})\/?$/i);
  const code = m?.[1].toUpperCase();
  return code && CODE_RE.test(code) ? code : null;
}

/** QR modules (true = dark) for a text, with medium error correction. */
export function qrMatrix(text: string): boolean[][] {
  const qr = makeQr(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

// ── Saving a QR as an image (black-and-white PNG, written by hand so no native module is needed) ──

// 5×7 capitals, digits and the characters usernames can have. Usernames are case-insensitive, so capitals are fine.
const GLYPHS: Record<string, string> = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111', '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
  _: '00000000000000000000000000000011111', '.': '00000000000000000000000000110001100',
  '@': '01110100011011110101101111000001111', ' ': '00000000000000000000000000000000000',
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class Bytes {
  private parts: number[] = [];
  u8(...v: number[]) {
    this.parts.push(...v.map((x) => x & 0xff));
  }
  u32(v: number) {
    this.u8(v >>> 24, v >>> 16, v >>> 8, v);
  }
  array(a: Uint8Array) {
    for (let i = 0; i < a.length; i++) this.parts.push(a[i]);
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

/** 1-bit grayscale PNG. `dark(x, y)` says which pixels are black. Uses uncompressed deflate blocks (small anyway). */
function png(width: number, height: number, dark: (x: number, y: number) => boolean) {
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1); // first byte of each row is the filter type (0 = none)
    for (let x = 0; x < width; x++) {
      if (!dark(x, y)) raw[row + 1 + (x >> 3)] |= 0x80 >> (x & 7); // 1 = white
    }
  }
  const z = new Bytes();
  z.u8(0x78, 0x01);
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const len = Math.min(65535, raw.length - i);
    z.u8(i + len >= raw.length ? 1 : 0, len, len >> 8, ~len, ~len >> 8);
    z.array(raw.subarray(i, i + len));
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  z.u32(((b << 16) | a) >>> 0);

  const out = new Bytes();
  out.u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
    body.set(data, 4);
    out.u32(data.length);
    out.array(body);
    out.u32(crc32(body));
  };
  const ihdr = new Bytes();
  ihdr.u32(width);
  ihdr.u32(height);
  ihdr.u8(1, 0, 0, 0, 0); // bit depth 1, grayscale, deflate, no filter, no interlace
  chunk('IHDR', ihdr.done());
  chunk('IDAT', z.done());
  chunk('IEND', new Uint8Array(0));
  return out.done();
}

/**
 * Writes the QR for `text`, with `caption` (e.g. "@rider_a") underneath, to a PNG in the cache folder.
 * Returns its URI and size, ready for the gallery.
 */
export function writeQrImage(text: string, caption: string) {
  const m = qrMatrix(text);
  const n = m.length;
  const scale = 12;
  const quiet = 4; // the blank border scanners need, in modules
  const width = (n + quiet * 2) * scale;
  const chars = caption.toUpperCase().split('').filter((c) => GLYPHS[c]);
  const textScale = Math.max(1, Math.min(5, Math.floor((width - 2 * scale) / Math.max(1, chars.length * 6))));
  const textW = chars.length * 6 * textScale - textScale;
  const textTop = width - scale; // the text sits in the lower quiet zone and below it
  const height = textTop + 7 * textScale + 2 * scale;
  const textLeft = Math.floor((width - textW) / 2);

  const bytes = png(width, height, (x, y) => {
    const qx = Math.floor(x / scale) - quiet;
    const qy = Math.floor(y / scale) - quiet;
    if (qx >= 0 && qy >= 0 && qx < n && qy < n) return m[qy][qx];
    const tx = x - textLeft;
    const ty = y - textTop;
    if (ty < 0 || tx < 0 || ty >= 7 * textScale || tx >= textW) return false;
    const ci = Math.floor(tx / (6 * textScale));
    const gx = Math.floor((tx % (6 * textScale)) / textScale);
    const gy = Math.floor(ty / textScale);
    return gx < 5 && GLYPHS[chars[ci]][gy * 5 + gx] === '1';
  });
  const file = new File(Paths.cache, `qr-${uid()}.png`);
  file.write(bytes);
  return { uri: file.uri, width, height };
}

// ── Reading a QR from a photo ──

function deleteQuietly(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // only a temporary file
  }
}

async function readAt(uri: string, size: number): Promise<string | null> {
  // Shrinking first keeps decoding fast; re-saving as JPEG means PNG, HEIC and WebP all work the same way.
  const image = await ImageManipulator.manipulate(uri).resize({ width: size }).renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  try {
    const bytes = await new File(out.uri).bytes();
    const { data, width, height } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4 });
    const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height, {
      inversionAttempts: 'attemptBoth',
    });
    return found?.data ?? null;
  } finally {
    deleteQuietly(out.uri);
  }
}

/** The text in the first QR code found in an image, or null. Tries a couple of sizes (small QRs need more pixels). */
export async function decodeQrImage(uri: string): Promise<string | null> {
  for (const size of [800, 1400]) {
    try {
      const text = await readAt(uri, size);
      if (text) return text;
    } catch (e) {
      console.warn('QR decode failed', e);
    }
  }
  return null;
}
