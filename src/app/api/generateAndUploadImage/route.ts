// app/api/generateAndUpload/route.ts
import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import OpenAI from "openai";

// ---------- utils ----------
function dedupLower(arr: string[]) {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const t of arr || []) {
    const k = String(t ?? "")
      .trim()
      .toLowerCase();
    if (k && !seen[k]) {
      seen[k] = true;
      out.push(String(t).trim());
    }
  }
  return out;
}

function join(arr?: string[] | null, sep = ", ") {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return "";
  return arr
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(sep);
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v == null) return [];
  // comma-separated string support
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- clients ----------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ---------- route ----------
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Log safely
    try {
      console.log("attempts remix___:", body, JSON.stringify(body).slice(0, 500));
    } catch {
      console.log("attempts remix: [unserializable body]");
    }

    // #### New rich fields ####
    const prompt: string = String(body?.prompt ?? "");
    const adjectives: string = String(body?.adjectives ?? "");
    const styles: string[] = asArray(body?.styles);
    const communities: string[] = asArray(body?.communities);
    const trends: string[] = asArray(body?.trends);
    const descriptions: string[] = asArray(body?.descriptions);
    const parentIds: string[] = asArray(body?.parentIds);
    const people: string[] = asArray(body?.people);
    // support both "object" and "objects"
    const objectsArr: string[] = asArray(body?.objects ?? body?.object);

    // #### Back-compat fields (optional) ####
    const folder: string = String(body?.folder ?? "imageEcology");
    const communityFallback: string = String(body?.community ?? "");
    const titleIn: string = String(body?.title ?? "");
    const userTagsArr: string[] = asArray(body?.tags);

    // Compose a single, high-signal prompt for the LLM → Image generator
    const userPrompt = [
      `You are an image prompt engineer crafting a *single* vivid social media image prompt in English. PLease ensure the prompt will follow our content guidelines.`,
      `Source descriptions (merge meanings, avoid literal collage text):`,
      ...descriptions.map((d) => `- ${d}`),
      "",
      `Desired vibe / tags: ${adjectives || "—"}`,
      styles.length ? `Style cues: ${join(styles)}` : "",
      communities.length || communityFallback
        ? `Community context: ${join(
            communities.length ? communities : [communityFallback]
          )}`
        : "",
      trends.length ? `Trending motifs: ${join(trends)}` : "",
      people.length ? `including: ${join(people)}` : "",
      "",
      `Constraints:`,
      `- Unify the scene into one coherent world; not a grid.`,
      `- If multiple styles are present, harmonize rather than list.`,
    ]
      .filter(Boolean)
      .join("\n");

    // Prompt expansion (compact, one-line)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // compact + capable
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

    const sentenceRaw = completion.choices?.[0]?.message?.content ?? "";
    const remixedPrompt = sentenceRaw.replaceAll('"', "").trim();

    const safetySuffix =
      "Square image. No text, no UI, no watermark, no signatures.";

    console.log("makes image from parents: ", sentenceRaw);

    // Image generation
    const imageGen = await openai.images.generate({
      model: "dall-e-3",
      prompt: `${remixedPrompt}\n${safetySuffix}`.trim(),
      n: 1,
      size: "1024x1024",
    });

    const b64 = imageGen.data?.[0]?.b64_json ?? null;
    const remoteUrl = imageGen.data?.[0]?.url ?? null;
    if (!b64 && !remoteUrl) {
      return NextResponse.json(
        { error: "Image generation returned no data" },
        { status: 502 }
      );
    }
    const uploadSource = b64
      ? `data:image/png;base64,${b64}`
      : (remoteUrl as string);

    // Title to store (prefer explicit title, then remixed, then original prompt)
    const titleToStore = titleIn || remixedPrompt || prompt || "image";

    // Pick one community string to store in context (if arrays present, use first)
    const communityToStore =
      (communities && communities[0]) || communityFallback || "";

    // ---------- Upload to Cloudinary ----------
    const uploadResult = await cloudinary.uploader.upload(uploadSource, {
      folder,
      context: {
        alt: titleToStore,
        caption: titleToStore,
        parentIds: parentIds.length ? parentIds.join(",") : "",
        community: communityToStore,
      },
      moderation:
        "aws_rek:" +
        "explicit_nudity:0.7:" +
        "hate_symbols:0.6:" +
        "suggestive:ignore:" +
        "violence:ignore:" +
        "visually_disturbing:ignore:" +
        "rude_gestures:ignore:" +
        "drugs:ignore:" +
        "tobacco:ignore:" +
        "alcohol:ignore:" +
        "gambling:ignore",
    });

    // Moderation check
    const moderationArr = (uploadResult as any).moderation as
      | {
          status: string;
          kind: string;
          info?: Record<string, any>;
        }[]
      | undefined;

    const wasRejected = moderationArr?.some(
      (m) => m.status === "rejected" && m.kind?.startsWith("aws_rek")
    );
    if (wasRejected) {
      return NextResponse.json(
        { error: "image does not adhere to our policy" },
        { status: 400 }
      );
    }

    // ---------- Vision enrichment ----------
    const visionPrompt = `
You will be given an image collected in a users social media feed: "${titleToStore}".

Return ONLY minified JSON with these keys:
{"title":"","caption":"","altText":"","feeling":"","so_me_type":"","trend":"","style":"","tags":[],"vibe":[],"objects":[],"scenes":[],"people":[]}

Rules:
- "title": ≤ 7 words, aligned with "${titleToStore}" (refine if needed).
- "caption": ≤ 2 sentences.
- "altText": ≤ 15 words, describing neutrally the image.
- "so_me_type": a title that might identify which Social Media Archetype the image might belong to.
- "trend": a title that might identify which viral trend the image belongs to.
- "tags": up to 12 short tags (nouns/adjectives; no hashtags/emojis).
- "feeling": speculate what feelings it might produce / why we look at it.
- "objects": up to 8 concrete things visible.
- "style": sentences describing the image style for reproduction (photograph/illustration/etc., realism, other style notes).
- "people": check if there are faces; describe each; name celebrity if applicable.
- No extra text; JSON only.`;

    const vision = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: visionPrompt },
            {
              type: "image_url",
              image_url: { url: uploadResult.secure_url as string },
            },
          ],
        },
      ],
    });

    const raw = vision.choices?.[0]?.message?.content ?? "{}";
    let ai: any = {};
    try {
      ai = JSON.parse(raw);
    } catch {
      ai = {};
    }

    const payload = {
      title: String(ai?.title ?? titleToStore ?? "").trim(),
      caption: String(ai?.caption ?? "").trim(),
      altText: String(ai?.altText ?? "").trim(),
      so_me_type: String(ai?.so_me_type ?? "").trim(),
      feeling: String(ai?.feeling ?? "").trim(),
      trend: String(ai?.trend ?? "").trim(),
      style: String(ai?.style ?? "").trim(),
      people: Array.isArray(ai?.people) ? ai.people.map(String) : [],
      tags: Array.isArray(ai?.tags) ? ai.tags.map(String) : [],
      vibe: Array.isArray(ai?.vibe) ? ai.vibe.map(String) : [],
      objects: Array.isArray(ai?.objects) ? ai.objects.map(String) : [],
      scenes: Array.isArray(ai?.scenes) ? ai.scenes.map(String) : [],
    };

    // Merge tags: user adjectives & arrays → vision inference
    const adjectivesAsTags = asArray(adjectives);
    const mergedFromVision = dedupLower([
      ...payload.tags,
      ...payload.vibe,
      ...payload.objects,
      ...payload.scenes,
      ...objectsArr,
      ...people,
      ...styles,
      ...trends,
      ...communities,
    ]).slice(0, 25);

    const finalTags = dedupLower([
      ...mergedFromVision,
      ...adjectivesAsTags,
      ...userTagsArr,
    ]);

    // Cloudinary expects comma-separated tags when using explicit()
    const tagsString = finalTags.join(",");

    // ---------- Enrich Cloudinary asset ----------
    await cloudinary.uploader.explicit(uploadResult.public_id, {
      type: "upload",
      tags: tagsString,
      context: {
        caption: titleToStore,
        alt: payload.altText,
        ai_title: payload.title,
        ai_style: payload.style,
        ai_trend: payload.trend,
        ai_so_me_type: payload.so_me_type,
        ai_feeling: payload.feeling,
        ai_vibe: (payload.vibe || []).join(", "),
        ai_objects: (payload.objects || []).slice(0, 5).join(", "),
        community: communityToStore,
        parentIds: parentIds.join(","),
        ai_people: payload.people,
        // also echo inputs for lineage/auditing
        remix_prompt: remixedPrompt,
      },
    });

    // ---------- Response (compatible with your client DTO) ----------
    return NextResponse.json({
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      title: titleToStore,
      alt: payload.altText,
      ai_title: payload.title,
      ai_vibe: (payload.vibe || []).join(", "),
      ai_objects: (payload.objects || []).slice(0, 5).join(", "),
      ai_style: payload.style,
      ai_trend: payload.trend,
      ai_so_me_type: payload.so_me_type,
      community: communityToStore,
      tags: finalTags, // array
      parentIds: parentIds.length ? parentIds : null,
      ai_people: payload.people,
      remixedPrompt, // handy for UI/extras
      // also return raw inputs for reference
      inputs: {
        prompt,
        adjectives,
        styles,
        communities,
        trends,
        descriptions,
        people,
        objects: objectsArr,
      },
    });
  } catch (error) {
    console.error("Generate+Upload error:", error);
    return NextResponse.json(
      { error: "Failed to generate and upload image" },
      { status: 500 }
    );
  }
}
