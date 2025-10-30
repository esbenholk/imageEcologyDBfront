import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

import OpenAI from "openai";

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: Request) {
  try {
    const { imageUrl, title, tags, parentIds, community } =
      await request.json();
    // Upload image to Cloudinary
    console.log("IMAGE UPLOAD", title, tags, parentIds, community);

    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: "imageEcology",
      context: {
        alt: title,
        caption: title,
        parentIds: parentIds != null ? parentIds.toString() : "",
        community: community != null ? community : null,
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

    // moderation check
    const moderationArr = (result as any).moderation as
      | {
          status: string;
          kind: string;
          info?: Record<string, any>;
        }[]
      | undefined;

    const wasRejected = moderationArr?.some(
      (m) => m.status === "rejected" && m.kind.startsWith("aws_rek")
    );
    console.log("rejection", wasRejected);

    if (!wasRejected) {
      console.log("image not rejected", wasRejected);

      const visionPrompt = `
You will be given an image from a user's social feed titled: "${title}".

Return ONLY minified JSON with these keys:
{"title":"","caption":"","altText":"","so_me_type":"","trend":"","feeling":"","tags":[],"vibe":[],"objects":[],"scenes":[],"people":[],"style":""}

Rules:
- Output strictly minified JSON. No commentary, no newlines.
- "title": ≤7 words, aligned with "${title}" (refine if needed).
- "caption": ≤2 sentences.
- "altText": ≤15 words, literal neutral description.
- "so_me_type": a short label of the social media archetype (e.g., "travel aesthetic", "haul review").
- "trend": short name of any identifiable trend (e.g., "get ready with me") or "".
- "feeling": short phrase for emotional tone or desire.
- "tags": up to 12 short tags (nouns/adjectives only; no hashtags/emojis).
- "vibe": 3–7 mood or atmosphere words.
- "objects": ≤8 concrete visible things.
- "scenes": up to 3 concise scene descriptors (e.g., "urban rooftop at sunset").
- "people": array of brief descriptors (age range, gender presentation, expression, celebrity if clear).

STYLE (critical for reproduction):
- "style" must be a **single, coherent natural-language string** that can be reused directly as a generative image prompt.
- It should describe:
  • the medium (photograph, 3D render, illustration, etc.)
  • the realism level ("photorealistic", "hyperrealistic", "stylized", "cartoon", etc.)
  • lighting (type, quality, direction, time of day)
  • color treatment (palette, tone, contrast)
  • composition (framing, perspective)
  • postprocessing or aesthetic look (film grain, cinematic grading, matte finish, etc.)
  • influences or mood adjectives that help reproduce the image vibe.
- If the source image is a photograph, the string MUST clearly state that it’s **“photograph” or “photorealistic photo”**, and must not include non-photo terms like “painting”, “illustration”, or “digital art”.
- Use concise, comma-separated descriptive tokens suitable for an image model prompt.
- Avoid fluff. Aim for ~1–3 short sentences or a comma-separated list.

Output minified JSON only.
`;

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: visionPrompt,
            },
            { type: "image_url", image_url: { url: imageUrl } }, // URL or base64 data URL
          ],
        },
      ];
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.3,
        response_format: { type: "json_object" }, // ensures pure JSON
        max_tokens: 400, // keep costs low
      });

      console.log("openai answers", completion);

      const raw = completion.choices[0]?.message?.content ?? "{}";

      let ai;
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
      };

      const mergedTags = dedupLower([
        ...payload.tags,
        ...payload.vibe,
        ...payload.objects,
      ]).slice(0, 25); // keep it tidy

      let mergedTagsString = mergedTags.join(",");

      if (tags != null) {
        mergedTagsString += ", " + tags;
      }
      console.log("OPENAI PAYLOAD", payload);

      await cloudinary.uploader.explicit(result.public_id, {
        type: "upload",
        tags: mergedTagsString, // or use add_tag(...) to append
        context: {
          caption: title,
          alt: payload.altText,
          ai_title: payload.title,
          ai_style: payload.style,
          ai_trend: payload.trend,
          ai_so_me_type: payload.so_me_type,
          ai_feeling: payload.feeling,
          ai_vibe: (payload.vibe || []).join(", "),
          ai_objects: (payload.objects || []).slice(0, 5).join(", "),
          community: community,
          parentIds: parentIds != null ? parentIds : "",
          ai_people: payload.people,
        },
      });

      return NextResponse.json({
        url: result.secure_url,
        publicId: result.public_id,
        title: title,
        alt: payload.altText,
        ai_title: payload.title,
        ai_vibe: (payload.vibe || []).join(", "),
        ai_objects: (payload.objects || []).slice(0, 5).join(", "),
        ai_style: payload.style,
        ai_trend: payload.trend,
        ai_so_me_type: payload.so_me_type,
        community: community,
        tags: mergedTags.concat(tags),
        parentIds: parentIds != null && parentIds,
        ai_people: payload.people,
      });
    } else {
      console.error("explicit image");
      return NextResponse.json(
        { error: "image does not adhere to our policy" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}
