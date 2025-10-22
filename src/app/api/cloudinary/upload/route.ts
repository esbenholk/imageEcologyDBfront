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
        community: community,
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
        You will be given an image collected in a users social media feed: "${title}".

        Return ONLY minified JSON with these keys:
        {"title":"","caption":"","altText":"","feeling":"","so_me_type":"", "trend: "", "style: "", "feeling": "","tags":[],"vibe":[],"objects":[],"scenes":[], "people":[]}

        Rules:
        - "title": ≤ 7 words, aligned with "${title}" (refine if needed).
        - "caption": ≤ 2 sentences".
        - "altText": ≤ 15 words, describing neutrally the image. 
        - "so_me_type": a title that might idenitify which Social Media Archetype the image might belong to".
        - "trend": a title that might idenitify which viral trend the image belongs to".
        - "tags": up to 12 short tags (nouns/adjectives; no hashtags/emojis).
        - "feeling": speculate what feelings it might produce looking at the picture and/or what feelings are the reason i want to look at the image.
        - "objects": up to 8 concrete things visible.
        - "style": up to 2 sentences describing the image style for further image prompting and reproducing.
        - "people": check if there are any faces. Please describe each face. If they are a celebrity, please name them.
        - No extra text; JSON only.`;

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
