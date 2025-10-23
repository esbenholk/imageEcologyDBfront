// app/api/generateImage/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GenerationResult {
  sentence: string;
  imageUrl: string;
  trends: string[];
  geo: string;
}

/** Helper: safe join */
const join = (arr?: string[] | null, sep = ", ") =>
  Array.isArray(arr)
    ? arr
        .filter(Boolean)
        .map((s) => s.trim())
        .join(sep)
    : "";

/** ---------- NEW: POST (rich remix context) ---------- */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    console.log("attempts remix:" + body);

    const {
      prompt = "",
      adjectives = "",
      styles = [],
      communities = [],
      trends = [],
      descriptions = [],
      parentIds = [],
      people = [],
      object = [],
    } = body ?? {};

    // Compose a single, high-signal prompt for the LLM → Image generator
    // Keep it concise but explicit about constraints.
    const userPrompt = [
      `You are an image prompt engineer crafting a *single* vivid social media image prompt in English.`,
      `Source descriptions (merge meanings, avoid literal collage text):`,
      ...descriptions.map((d: string) => `- ${d}`),
      "",
      `Desired vibe / tags: ${adjectives || "—"}`,
      styles.length ? `Style cues: ${join(styles)}` : "",
      communities.length ? `Community context: ${join(communities)}` : "",
      trends.length ? `Trending motifs: ${join(trends)}` : "",
      people.length ? `including: ${join(people)}` : "",
      "",
      `Constraints:`,
      `- Unify the scene into one coherent world; not a grid.`,
      `- If multiple styles are present, harmonize rather than list.`,
    ]
      .filter(Boolean)
      .join("\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "Return a single, compact prompt line suitable for an image model; no preamble; no lists.",
        },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 180,
      temperature: 0.8,
    });

    // LLM → final prompt text
    const sentenceRaw = completion.choices[0]?.message?.content ?? "";
    const sentence = sentenceRaw.replaceAll('"', "").trim();

    // Optional style reinforcement (kept short to avoid drowning the core prompt)
    const safetySuffix =
      "Square image. No text, no UI, no watermark, no signatures.";

    // Image generation
    const image = await openai.images.generate({
      model: "dall-e-3",
      prompt: `${sentence}\n${safetySuffix}`.trim(),
      n: 1,
      size: "1024x1024",
    });

    console.log("produces image for:" + userPrompt);

    const data = {
      // Echo for clients to store lineage / metadata
      parentIds,
      styles,
      communities,
      trends,
      tags: adjectives,
      // Main outputs
      prompt, // original merged prompt (if any)
      remixedPrompt: sentence,
      imageUrl: image.data?.[0]?.url || "imageurlplaceholder",
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error("Generation error (POST):", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}

/** ---------- Existing GET (kept for compatibility) ---------- */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const prompt = url.searchParams.get("prompt") || "";
    const adjectives = url.searchParams.get("adjectives") || "";

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content:
            `pretend that you are an image prompt engineer that is trying to produce social media content.` +
            `We need to write an image prompt that expands on and depicts the following sentence: There is... ${prompt}. ` +
            `The image should fit this vibe: ${adjectives} and be in the style of mediaval drawings or post-internet graphics and sci-fi, ` +
            `please output an image prompt in english`,
        },
      ],
      max_tokens: 100,
    });

    const sentence = (completion.choices[0].message.content || "").replace(
      '"',
      ""
    );

    const styleSuffix =
      "the image should be in the style of mideaval drawings, fantasy, post-internet graphics and sci-fi. the image is not allowed to show any caption or UI element.";

    const image = await openai.images.generate({
      model: "dall-e-3",
      prompt: `${sentence}\n${styleSuffix}`.trim(),
      n: 1,
      size: "1024x1024",
    });

    const data = {
      prompt,
      remixedPrompt: sentence,
      imageUrl: image.data ? image.data[0].url : "imageurlplaceholder",
      tags: adjectives,
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error("Generation error (GET):", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}
