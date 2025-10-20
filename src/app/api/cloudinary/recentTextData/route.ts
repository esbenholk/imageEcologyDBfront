import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const pick = (obj: any, kCamel: string, kSnake: string) =>
  obj?.[kCamel] ?? obj?.[kSnake] ?? null;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const skip = parseInt(url.searchParams.get("skip") || "0", 10);
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);
  const folder = url.searchParams.get("folder") || "utopias";

  try {
    const res = await cloudinary.search
      .expression(`folder="${folder}"`)
      .sort_by("created_at", "desc")
      .with_field("context")
      .with_field("metadata")
      .max_results(skip + limit)
      .execute();

    const items = (res.resources || [])
      .slice(skip, skip + limit)
      .map((r: any) => {
        const cx = r.context?.custom ?? r.context ?? {};
        const md = r.metadata ?? {};

        const aiTitle =
          pick(cx, "aiTitle", "ai_title") ?? pick(md, "aiTitle", "ai_title");

        const title =
          pick(cx, "caption", "caption") ??
          pick(md, "title", "title") ??
          r.public_id?.split("/").pop() ??
          "Untitled";

        const alt =
          pick(cx, "alt", "alt") ?? pick(md, "description", "description");

        // Construct a fresh object—no spreading—so only these keys are returned.
        return { title, aiTitle, alt };
      });

    return NextResponse.json(items, {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("Cloudinary fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch images" },
      { status: 500 }
    );
  }
}
