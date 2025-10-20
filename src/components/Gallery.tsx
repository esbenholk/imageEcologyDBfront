"use client";

import { Card } from "../app/components/Card";
import { useState, useEffect } from "react";

import { ImageCardProps } from "./imageCardProps";

export default function Gallery({
  news,
  poorRemixedImageIntoCouldron,
  shareImageToSocket,
}: {
  news: ImageCardProps[];
  poorRemixedImageIntoCouldron: (image: ImageCardProps) => void;
  shareImageToSocket: (image: ImageCardProps) => void;
}) {
  const [showRemixer, setShowRemixer] = useState(false);
  const [text, setText] = useState<string>("");

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [collagedImage, setCollagedImage] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<ImageCardProps[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploadLoading] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [selectedParentIds, setSelectedParentIDs] = useState<string[]>([]);

  const joinWithComma = (words: string[]): string => {
    return words.join(", ");
  };

  const generateImage = async () => {
    setLoading(true);
    setCollagedImage(null);

    if (selectedImages.length > 1) {
      try {
        let prompts = [];
        let tags = [];
        let ids = [];
        for (let index = 0; index < selectedImages.length; index++) {
          const element = selectedImages[index];
          prompts.push(element.description);
          ids.push(element.url);
          for (let index = 0; index < element.tags.length; index++) {
            const tag = element.tags[index];
            tags.push(tag);
          }
        }

        setSelectedParentIDs(ids);

        const response = await fetch(
          `/api/generateImage?prompt=${encodeURIComponent(
            joinWithComma(prompts) || "utopias"
          )}&adjectives=${encodeURIComponent(
            joinWithComma(tags) || ""
          )}&remixed=yes`
        );
        const data = await response.json();

        setText(data.remixedPrompt);
        setWords(tags);

        if (!response.ok) throw new Error(data.error || "Generation failed");
        // setImage(null);
        setGeneratedImage(data.imageUrl);
        // setText(data.sentence);
      } catch (err) {
        // setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  };

  const generateCollage = async () => {
    if (selectedImages.length < 2) return;
    setLoading(true);
    setGeneratedImage(null); // ensure we only preview one at a time
    try {
      const ids = selectedImages.map((i) => i.url);
      setSelectedParentIDs(ids);

      const dataUrl = (await mosaicBlend(ids, {
        size: 1024,
        block: 32,
        returnType: "dataURL",
        seed: undefined, // set a number for reproducible output, e.g., 42
      })) as string;

      // Optional: set a descriptive caption for the upload UI
      if (!text) setText("collage of fragments");
      if (words.length === 0) {
        const tags = selectedImages.flatMap((i) => i.tags || []);
        setWords(tags);
      }

      setCollagedImage(dataUrl);
    } catch (e) {
      console.error("Collage failed", e);
    } finally {
      setLoading(false);
    }
  };
  const upLoadImage = async (_image: string) => {
    try {
      setUploadLoading(true);
      console.log("uploads image file", _image, text, selectedParentIds);

      let tags = joinWithComma(words);
      const response = await fetch(`/api/cloudinary/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: _image,
          sentence: text || "utopias",
          alt: text || "utopias",
          title: text || "utopias",
          tags: tags,
          remixedPrompt: text,
          parentIds: selectedParentIds,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        console.log("fails upload to cloud", data);
        setUploadLoading(false);
        throw new Error(data.error || "Upload failed");
      }

      console.log("remixes", data);

      const _imageCardProp: ImageCardProps = {
        title: data.title,
        url: data.url,
        tags: data.tags,
        aiCaption: data.caption,
        description: data.alt || "Untitled",
        aiTitle: data.ai_title,
        aiVibe: data.ai_vibe,
        aiObjects: data.ai_objects,
        aiFeeling: data.ai_feeling,
        id: data.id,
        community: data.community,
        parentIds: data.parentIds,
        ai_so_me_type: data.aiSoMeType,
        aiStyle: data.aiStyle,
        aiTrend: data.aiTrend,
      };

      poorRemixedImageIntoCouldron(_imageCardProp);
      shareImageToSocket(_imageCardProp);
      // let tempnews = news;
      // tempnews.unshift(_imageCardProp);
      // setNews(tempnews);

      // console.log(tempnews);
    } catch (err) {
      console.log("fails upload to cloud", err);
      setUploadLoading(false);
    } finally {
      console.log("ends upload to cloud");

      setLoading(false);
      setUploadLoading(false);
      setShowRemixer(false);
      // showSucces();
      setSelectedImages([]);
      setGeneratedImage(null);
      setCollagedImage(null);

      setSelectedParentIDs([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    console.log("tries to submit image", generatedImage);

    if (generatedImage) {
      upLoadImage(generatedImage);
    } else if (collagedImage) {
      upLoadImage(collagedImage);
    } else {
      console.log("make error message");
    }
  };

  const toggleSelection = (image: ImageCardProps) => {
    setSelectedImages((prev) =>
      prev.some((img) => img.url === image.url)
        ? prev.filter((img) => img.url !== image.url)
        : [...prev, image]
    );

    console.log(selectedImages);
  };

  useEffect(() => {
    setShowRemixer(false);
  }, []);

  return (
    <>
      {news.length > 0 && (
        <>
          {news.map((image) => {
            const isSelected = selectedImages.some(
              (img) => img.url === image.url
            );
            return (
              <div
                key={image.id ?? image.url} // ✅ stable key
                className={`Card ${isSelected ? "selected" : ""}`}
              >
                <Card data={image} />
                <button
                  onClick={() => toggleSelection(image)}
                  className="mt-2 flex items-center gap-1"
                >
                  {!isSelected ? "remix" : "remove from remix"}
                </button>
              </div>
            );
          })}

          {showRemixer && (
            <>
              <div className="backdrop">
                {uploading && (
                  <img
                    className={"loadingAnim"}
                    src="https://res.cloudinary.com/dmwpm8iiw/image/upload/v1755241109/uploader_oxznq4.png"
                  />
                )}
              </div>

              <form
                onSubmit={handleSubmit}
                className={uploading ? "uploading uploader" : "uploader"}
              >
                <button
                  className="closebtn"
                  onClick={() => setShowRemixer(false)}
                >
                  {" "}
                  X{" "}
                </button>
                <div className="selectedImages">
                  {selectedImages.map((image, index) => (
                    <button
                      key={index}
                      onClick={() => toggleSelection(image)}
                      className={
                        loading ||
                        generatedImage != null ||
                        collagedImage != null
                          ? "miniButton"
                          : "adjBtn"
                      }
                    >
                      <img src={image.url} />
                    </button>
                  ))}
                </div>
                <div className="imageResult">
                  {loading ? (
                    <>
                      <img src="https://res.cloudinary.com/dmwpm8iiw/image/upload/v1742059296/brewing_ruxhpm.gif" />
                    </>
                  ) : generatedImage ? (
                    <div>
                      {/* <button className="closebtn" onClick={()=> setGeneratedImage(null)}> X </button> */}
                      <img
                        src={generatedImage}
                        alt="Generated"
                        className="w-full rounded-lg"
                      />
                    </div>
                  ) : collagedImage ? (
                    <>
                      {" "}
                      <img
                        src={collagedImage}
                        alt="Generated"
                        className="w-full rounded-lg"
                      />
                    </>
                  ) : null}
                </div>

                <div className="uploaderButtons galleryUploaderButtons">
                  <button
                    disabled={loading}
                    className={!loading ? "active" : "passive"}
                    onClick={() => generateImage()}
                  >
                    {generatedImage
                      ? "recreate vision (AI)"
                      : "remix fragments into vision (ai)"}
                  </button>

                  <button
                    disabled={loading}
                    className={!loading ? "active" : "passive"}
                    onClick={() => generateCollage()}
                  >
                    {collagedImage
                      ? "reblend collage"
                      : "collage fragments into vision"}
                  </button>
                  <button
                    type="submit"
                    // disabled={loading || (!text && !image)}
                    className={
                      loading
                        ? "passive"
                        : generatedImage || collagedImage
                        ? "active"
                        : "passive"
                    }
                  >
                    {loading ? "loading content" : <>pour into potion</>}
                  </button>
                </div>
              </form>
            </>
          )}

          {selectedImages.length >= 2 && (
            <button
              className={`remixButton ${showRemixer ? "lil" : ""}`}
              onClick={() => setShowRemixer(!showRemixer)}
            >
              Remix Fragments
            </button>
          )}
        </>
      )}
    </>
  );
}

type ImgSource = string | HTMLImageElement;

interface MosaicOptions {
  size?: number; // default 1024
  block?: number; // default 32
  seed?: number | null; // optional seed
  returnType?: "canvas" | "dataURL" | "blob";

  // NEW – soft overlays
  overlayPatchesPerImage?: number; // default 5
  overlaySizeRange?: [number, number]; // default [48, 192]
  overlayBlendMode?: GlobalCompositeOperation; // default "overlay" (fallback: "multiply")
  overlayAlpha?: number; // default 0.6
}

async function mosaicBlend(
  sources: ImgSource[],
  opts: MosaicOptions = {}
): Promise<HTMLCanvasElement | string | Blob> {
  const size = opts.size ?? 1024;
  const block = 64 * 2;
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
  const randFloat = (min: number, max: number) => rng() * (max - min) + min;

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

  // ---- base mosaic (32×32 blocks by default)
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

  // ---- soft overlays (random rects from each image, drawn back at same coords)
  const patchesPerImage = opts.overlayPatchesPerImage ?? 5;
  const [minSide, maxSide] = opts.overlaySizeRange ?? [64 * 2, 64 * 5];
  const blend: GlobalCompositeOperation = (opts.overlayBlendMode ??
    "overlay") as GlobalCompositeOperation;
  const alpha = opts.overlayAlpha ?? 0.6;

  // save state
  const prevOp = octx.globalCompositeOperation;
  const prevAlpha = octx.globalAlpha;

  // If "overlay" misbehaves in your target browser, switch to "multiply"
  octx.globalCompositeOperation = blend;
  octx.globalAlpha = alpha;

  for (const src of prepared) {
    for (let i = 0; i < patchesPerImage; i++) {
      // random size & aspect
      const w = randInt(minSide, maxSide);
      const h = randInt(minSide, maxSide * 1.25); // slight aspect variety
      const sx = randInt(0, Math.max(0, size - w));
      const sy = randInt(0, Math.max(0, size - h));

      // draw back at the *same* location (sx, sy)
      octx.drawImage(src, sx, sy, w, h, sx, sy, w, h);
    }
  }

  // restore
  octx.globalCompositeOperation = prevOp;
  octx.globalAlpha = prevAlpha;

  if (returnType === "canvas") return out;
  if (returnType === "dataURL") return out.toDataURL("image/png");
  if (returnType === "blob")
    return await new Promise<Blob>(
      (res) => out.toBlob((b) => res(b!), "image/png")!
    );
  return out;
}

function loadImage(src: ImgSource): Promise<HTMLImageElement> {
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
