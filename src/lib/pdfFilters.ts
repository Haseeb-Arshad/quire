// Per-theme color treatments for rendered PDF pages.
//
// The obvious approaches — CSS `filter` on the canvas, or ctx.filter at blit
// time — both go through Skia's GPU image-filter path, which mis-renders tall
// canvases (pages show up half-filtered on Chromium, GPU and SwiftShader
// alike). Every theme here is a chain of affine color operations, so instead
// we compose each chain into a single 3x3 matrix + offset and apply it to the
// raw pixels. putImageData writes the bitmap directly: what you measure is
// what you see, on every browser, no filter pipeline involved.

import type { PageTheme } from "./preferences";

interface Affine {
  /** Row-major 3x3 color matrix. */
  a: number[];
  /** Per-channel offset, 0..255 scale. */
  b: number[];
}

const IDENTITY: Affine = { a: [1, 0, 0, 0, 1, 0, 0, 0, 1], b: [0, 0, 0] };

/** apply `first`, then `second` (i.e. second ∘ first). */
function compose(second: Affine, first: Affine): Affine {
  const a = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      for (let k = 0; k < 3; k += 1) {
        a[row * 3 + col] += second.a[row * 3 + k] * first.a[k * 3 + col];
      }
    }
  }
  const b = [0, 1, 2].map(
    (row) =>
      second.a[row * 3] * first.b[0] +
      second.a[row * 3 + 1] * first.b[1] +
      second.a[row * 3 + 2] * first.b[2] +
      second.b[row]
  );
  return { a, b };
}

function chain(...filters: Affine[]): Affine {
  return filters.reduce((acc, next) => compose(next, acc), IDENTITY);
}

function scaleMatrix(m: number[], identityWeight: number, matrixWeight: number): number[] {
  const identity = IDENTITY.a;
  return m.map((value, index) => identity[index] * identityWeight + value * matrixWeight);
}

/* W3C Filter Effects primitives, as affine color transforms */

function invert(amount: number): Affine {
  return { a: [1 - 2 * amount, 0, 0, 0, 1 - 2 * amount, 0, 0, 0, 1 - 2 * amount], b: [255 * amount, 255 * amount, 255 * amount] };
}

function brightness(m: number): Affine {
  return { a: [m, 0, 0, 0, m, 0, 0, 0, m], b: [0, 0, 0] };
}

function contrast(m: number): Affine {
  const offset = 255 * (0.5 - 0.5 * m);
  return { a: [m, 0, 0, 0, m, 0, 0, 0, m], b: [offset, offset, offset] };
}

function sepia(amount: number): Affine {
  const s = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
  return { a: scaleMatrix(s, 1 - amount, amount), b: [0, 0, 0] };
}

function grayscale(amount: number): Affine {
  const g = [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722];
  return { a: scaleMatrix(g, 1 - amount, amount), b: [0, 0, 0] };
}

function saturate(s: number): Affine {
  return {
    a: [
      0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
      0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
      0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s
    ],
    b: [0, 0, 0]
  };
}

function hueRotate(degrees: number): Affine {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: [
      0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
      0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
      0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072
    ],
    b: [0, 0, 0]
  };
}

/* Theme chains — keep in sync with the reflow themes in styles/themes.css */

const THEME_TRANSFORMS: Record<PageTheme, Affine | null> = {
  white: null,
  paper: chain(sepia(0.14), brightness(0.985), saturate(0.92)),
  sepia: chain(sepia(0.42), brightness(0.96), contrast(0.94)),
  grey: chain(grayscale(0.25), brightness(0.9), contrast(0.88)),
  night: chain(invert(0.93), hueRotate(180), brightness(1.02), contrast(0.94)),
  focus: chain(invert(0.9), sepia(0.55), hueRotate(-25), brightness(0.95), saturate(1.3))
};

/** Copy the source canvas onto the target, applying the theme's color grade. */
export function blitThemed(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  pageTheme: PageTheme
): void {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext("2d");
  if (!context) return;
  context.drawImage(source, 0, 0);

  const transform = THEME_TRANSFORMS[pageTheme];
  if (!transform) return;

  const image = context.getImageData(0, 0, target.width, target.height);
  const data = image.data;
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = transform.a;
  const [b0, b1, b2] = transform.b;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = a0 * r + a1 * g + a2 * b + b0;
    data[i + 1] = a3 * r + a4 * g + a5 * b + b1;
    data[i + 2] = a6 * r + a7 * g + a8 * b + b2;
  }
  context.putImageData(image, 0, 0);
}
