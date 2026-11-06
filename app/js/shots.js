/**
 * Getting chat screenshots small enough to send, and still readable.
 *
 * A phone screenshot is ~1080×2400; a scroll capture (Galaxy's 스크롤 캡처, an
 * iPhone full-page shot) can be 1080×9000. The model reads images up to about
 * 1568px on the long edge and shrinks anything bigger itself, so sending the
 * original costs upload time for nothing — and shrinking a 9000px strip to fit
 * would leave the text a few pixels tall. So: a normal screenshot is scaled to
 * fit, and a tall one is cut into overlapping phone-shaped tiles first, each
 * scaled the same way. The overlap is there so no line is cut in half without
 * also appearing whole in the next tile; the prompt tells the model to drop the
 * repeat.
 */

export const MAX_EDGE = 1568;
export const MAX_TILES = 10;
const TILE_ASPECT = 2.2;      // height / width of one tile, about a phone screen
const OVERLAP = 0.12;         // of the tile height

/**
 * Where to cut one image. Pure, so it is testable without a canvas.
 * @returns {{y: number, h: number}[]}
 */
export function tilesFor(width, height) {
  const tileH = Math.round(width * TILE_ASPECT);
  if (height <= tileH * 1.15) return [{ y: 0, h: height }];
  const step = Math.round(tileH * (1 - OVERLAP));
  const out = [];
  for (let y = 0; ; y += step) {
    if (y + tileH >= height) { out.push({ y: Math.max(0, height - tileH), h: Math.min(tileH, height) }); break; }
    out.push({ y, h: tileH });
  }
  return out;
}

export function scaleFor(w, h) {
  return Math.min(1, MAX_EDGE / Math.max(w, h));
}

/**
 * @param {Blob[]} files screenshots, in the order the user picked them
 * @returns {Promise<{media_type: 'image/jpeg', data: string}[]>}
 * @throws {{code: 'too_many_shots'|'bad_image'}}
 */
export async function prepareShots(files) {
  const out = [];
  for (const f of files) {
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { throw { code: 'bad_image' }; }
    const tiles = tilesFor(bmp.width, bmp.height);
    if (out.length + tiles.length > MAX_TILES) {
      bmp.close?.();
      throw { code: 'too_many_shots' };
    }
    for (const t of tiles) {
      const k = scaleFor(bmp.width, t.h);
      const cw = Math.round(bmp.width * k);
      const ch = Math.round(t.h * k);
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';            // a transparent PNG must not turn black as JPEG
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(bmp, 0, t.y, bmp.width, t.h, 0, 0, cw, ch);
      const url = canvas.toDataURL('image/jpeg', 0.85);
      out.push({ media_type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) });
    }
    bmp.close?.();
  }
  return out;
}
