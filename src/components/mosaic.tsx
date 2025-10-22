// lib/mosaic.ts
export type ImgSource = string | HTMLImageElement;

export interface MosaicOptions {
  size?: number; // default 1024
  block?: number; // default 32
  seed?: number | null; // optional seed
  returnType?: "canvas" | "dataURL" | "blob";

  // soft overlays
  overlayPatchesPerImage?: number; // default 5
  overlaySizeRange?: [number, number]; // default [96, 320]
  overlayBlendMode?: GlobalCompositeOperation; // default "overlay" (fallback: "multiply")
  overlayAlpha?: number; // default 0.6
}

export async function mosaicBlend(
  sources: ImgSource[],
  opts: MosaicOptions = {}
): Promise<HTMLCanvasElement | string | Blob> {
  const size = opts.size ?? 1024;
  const block = opts.block ?? 64; // you had 64*2 with size%block check—keeping sane default here
  const returnType = opts.returnType ?? "canvas";
  if (size % block !== 0) throw new Error("size must be divisible by block");
  if (!sources.length) throw new Error("No images provided");

  // Seedable RNG (Mulberry32)
  let rng = Math.random;
  if (opts.seed != null) {
    let s = opts.seed >>> 0 || 1;
    rng = () => {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (min: number, max: number) =>
    Math.floor(rng() * (max - min + 1)) + min;

  // Load & normalize each source to size×size (cover fit)
  const prepared = await Promise.all(
    sources.map(async (src) => {
      const img = await loadImage(src);
      const cnv = document.createElement("canvas");
      cnv.width = size;
      cnv.height = size;
      const ctx = cnv.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";

      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const dx = (size - w) / 2;
      const dy = (size - h) / 2;
      ctx.drawImage(img, dx, dy, w, h);
      return cnv;
    })
  );

  // Output canvas
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const octx = out.getContext("2d")!;

  // base mosaic
  const tiles = size / block;
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const srcIdx = Math.floor(rng() * prepared.length);
      const src = prepared[srcIdx];
      const sx = tx * block;
      const sy = ty * block;
      octx.drawImage(src, sx, sy, block, block, sx, sy, block, block);
    }
  }

  // soft overlays
  const patchesPerImage = opts.overlayPatchesPerImage ?? 5;
  const [minSide, maxSide] = opts.overlaySizeRange ?? [96, 320];
  const blend: GlobalCompositeOperation = (opts.overlayBlendMode ??
    "overlay") as GlobalCompositeOperation;
  const alpha = opts.overlayAlpha ?? 0.6;

  const prevOp = octx.globalCompositeOperation;
  const prevAlpha = octx.globalAlpha;

  octx.globalCompositeOperation = blend;
  octx.globalAlpha = alpha;

  for (const src of prepared) {
    for (let i = 0; i < patchesPerImage; i++) {
      const w = randInt(minSide, maxSide);
      const h = randInt(minSide, Math.floor(maxSide * 1.25));
      const sx = randInt(0, Math.max(0, size - w));
      const sy = randInt(0, Math.max(0, size - h));
      octx.drawImage(src, sx, sy, w, h, sx, sy, w, h);
    }
  }

  octx.globalCompositeOperation = prevOp;
  octx.globalAlpha = prevAlpha;

  if (returnType === "canvas") return out;
  if (returnType === "dataURL") return out.toDataURL("image/png");
  if (returnType === "blob") {
    return await new Promise<Blob>((res) =>
      out.toBlob((b) => res(b!), "image/png")
    );
  }
  return out;
}

export function loadImage(src: ImgSource): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof src !== "string") {
      if (src.complete && src.naturalWidth) return resolve(src);
      src.onload = () => resolve(src);
      src.onerror = reject;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
