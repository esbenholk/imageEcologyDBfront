// app/api/generateAndUpload/route.ts
import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import OpenAI from "openai";

// ---------- utils ----------
function dedupLower(arr: string[]) {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const t of arr) {
    const k = t.trim().toLowerCase();
    if (k && !seen[k]) {
      seen[k] = true;
      out.push(t.trim());
    }
  }
  return out;
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
    const {
      prompt = "",
      adjectives = "",
      title = "",
      // tags can come as a string (comma-sep) or string[]
      tags,
      parentIds,
      community,
      folder = "imageEcology",
    }: {
      prompt?: string;
      adjectives?: string;
      title?: string;
      tags?: string | string[];
      parentIds?: string[] | string | null;
      community?: string | null;
      folder?: string;
    } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: "Missing required field: prompt" },
        { status: 400 }
      );
    }

    // ---------- (1) Expand prompt ----------
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content:
            `pretend you are an image prompt engineer. Expand this into a vivid single image prompt.\n` +
            `Sentence: ${prompt}\n` +
            `Vibe: ${adjectives}\n` +
            `Style hints: medieval drawings, post-internet graphics, sci-fi.\n` +
            `Output only the prompt.`,
        },
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    let remixedPrompt =
      completion.choices?.[0]?.message?.content?.replaceAll('"', "") ?? "";
    remixedPrompt = remixedPrompt
      .replaceAll("**", "")
      .replaceAll("*", "")
      .replace(/Image Prompt:\s*/i, "")
      .trim();

    // ---------- (2) Generate image ----------
    const imageGen = await openai.images.generate({
      model: "dall-e-3",
      prompt: remixedPrompt || prompt,
      size: "1024x1024",
      n: 1,
    });

    const b64 = imageGen.data?.[0]?.b64_json;
    const remoteUrl = imageGen.data?.[0]?.url;
    if (!b64 && !remoteUrl) {
      return NextResponse.json(
        { error: "Image generation returned no data" },
        { status: 502 }
      );
    }
    const uploadSource = b64
      ? `data:image/png;base64,${b64}`
      : (remoteUrl as string);

    // ---------- (3) Upload to Cloudinary (same moderation + context as Upload API) ----------
    const uploadResult = await cloudinary.uploader.upload(uploadSource, {
      folder,
      context: {
        alt: title || remixedPrompt || "image",
        caption: title || remixedPrompt || "image",
        parentIds:
          parentIds != null
            ? Array.isArray(parentIds)
              ? parentIds.toString()
              : String(parentIds)
            : "",
        community: community ?? null,
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

    // ---------- (4) Moderation check ----------
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

    // ---------- (5) Vision pass (aligned with new Upload API keys) ----------
    const visionPrompt = `
You will be given an image collected in a users social media feed: "${
      title || remixedPrompt || prompt
    }".

Return ONLY minified JSON with these keys:
{"title":"","caption":"","altText":"","feeling":"","so_me_type":"","trend":"","style":"","tags":[],"vibe":[],"objects":[],"scenes":[],"people":[]}

Rules:
- "title": ≤ 7 words, aligned with "${
      title || remixedPrompt || prompt
    }" (refine if needed).
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

    const visionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        {
          role: "user",
          content: [
            { type: "text", text: visionPrompt },
            { type: "image_url", image_url: { url: uploadResult.secure_url } },
          ],
        },
      ];

    const vision = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: visionMessages,
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 400,
    });

    const raw = vision.choices?.[0]?.message?.content ?? "{}";
    let ai: any = {};
    try {
      ai = JSON.parse(raw);
    } catch {
      ai = {};
    }

    const payload = {
      title: String(ai?.title ?? title ?? "").trim(),
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

    // ---------- (6) Merge tags exactly like Upload API ----------
    const mergedFromVision = dedupLower([
      ...payload.tags,
      ...payload.vibe,
      ...payload.objects,
      ...payload.scenes,
    ]).slice(0, 25);

    const userTags: string[] = Array.isArray(tags)
      ? tags
      : String(tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

    const finalTags = dedupLower([...mergedFromVision, ...userTags]);

    // Cloudinary expects comma-sep string for tags in explicit()
    const tagsString = finalTags.join(",");

    // ---------- (7) Enrich uploaded asset to mirror Upload API ----------
    await cloudinary.uploader.explicit(uploadResult.public_id, {
      type: "upload",
      tags: tagsString,
      context: {
        caption: title || remixedPrompt || prompt,
        alt: payload.altText,
        ai_title: payload.title,
        ai_style: payload.style,
        ai_trend: payload.trend,
        ai_so_me_type: payload.so_me_type,
        ai_feeling: payload.feeling,
        ai_vibe: (payload.vibe || []).join(", "),
        ai_objects: (payload.objects || []).slice(0, 5).join(", "),
        community: community ?? "",
        parentIds:
          parentIds != null
            ? Array.isArray(parentIds)
              ? parentIds
              : String(parentIds)
            : "",
        ai_people: payload.people,
      },
    });

    // ---------- (8) Response aligned with Upload API (plus remixedPrompt) ----------
    return NextResponse.json({
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      title: title || remixedPrompt || prompt,
      alt: payload.altText,
      ai_title: payload.title,
      ai_vibe: (payload.vibe || []).join(", "),
      ai_objects: (payload.objects || []).slice(0, 5).join(", "),
      ai_style: payload.style,
      ai_trend: payload.trend,
      ai_so_me_type: payload.so_me_type,
      community: community ?? "",
      tags: finalTags, // array (client can join if needed)
      parentIds:
        parentIds != null
          ? Array.isArray(parentIds)
            ? parentIds
            : String(parentIds)
          : null,
      ai_people: payload.people,
      remixedPrompt, // handy for your UI/extras
    });
  } catch (error) {
    console.error("Generate+Upload error:", error);
    return NextResponse.json(
      { error: "Failed to generate and upload image" },
      { status: 500 }
    );
  }
}
