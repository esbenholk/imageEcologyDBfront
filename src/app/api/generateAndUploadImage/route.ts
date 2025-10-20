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
      tags = "",
      parentIds,
      folder = "utopias",
    } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: "Missing required field: prompt" },
        { status: 400 }
      );
    }

    console.log("getting ready to make img:" + prompt);

    // 1) Expand prompt (cheap text model is fine; keep your original wording)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `pretend that you are an image prompt engineer that is trying to depict a scene in a world. We need to write an image prompt that expands on and depicts the following sentence: There is... ${prompt}. The world should fit this vibe: ${adjectives} and be in the style of mediaval drawings or post-internet graphics and sci-fi,  please output an image prompt in english`,
        },
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    let remixedPrompt = completion.choices[0].message.content || "";
    remixedPrompt = remixedPrompt
      .replaceAll('"', "")
      .replaceAll("** imageprompt **", "")
      .replaceAll("*", "")
      .replaceAll("Image Prompt:", "")
      .trim();

    console.log("has prompt:" + remixedPrompt);

    // 2) Generate image (use base64 -> data URI for direct upload)
    const imageGen = await openai.images.generate({
      model: "dall-e-3",
      prompt: `${remixedPrompt}`.trim(),
      size: "1024x1024",
      n: 1,
      // quality: "standard", // optional
      // style: "vivid",      // optional
      // response_format: "b64_json" // default when using b64 access below
    });

    const b64 = imageGen.data?.[0]?.b64_json;
    const remoteUrl = imageGen.data?.[0]?.url;

    console.log("has image:" + remoteUrl);

    if (!b64 && !remoteUrl) {
      return NextResponse.json(
        { error: "Image generation returned no data" },
        { status: 502 }
      );
    }

    // Prefer base64 → data URI (Cloudinary supports this). Fallback to remote URL.
    const uploadSource = b64
      ? `data:image/png;base64,${b64}`
      : (remoteUrl as string);

    // 3) Upload to Cloudinary (with your moderation settings)
    const uploadResult = await cloudinary.uploader.upload(uploadSource, {
      folder,
      context: {
        alt: "sampl",
        caption: "sampl",
        parentIds: parentIds != null ? String(parentIds) : "",
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

    console.log("uploadresult:" + uploadResult);

    // 4) Moderation check
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

    console.log("checks for decency" + wasRejected + moderationArr);

    if (wasRejected) {
      return NextResponse.json(
        { error: "image does not adhere to our policy" },
        { status: 400 }
      );
    }

    console.log("image was not rejected:" + !wasRejected);

    // 5) Vision pass to extract metadata (same prompt you used)
    const visionPrompt = `
You will be given an image of a "Utopia" and the intended title: "${prompt}".

Return ONLY minified JSON with these keys:
{"title":"","caption":"","altText":"","extended_story":"","political_state":"","tags":[],"vibe":[],"objects":[],"scenes":[]}

Rules:
- "title": ≤ 7 words, aligned with "${prompt}" (refine if needed).
- "caption": ≤ 2 sentences, start with "in our utopia there is".
- "altText": ≤ 15 words, describing neutrally the image. 
- "extended_story": ≤ 3 sentences fiction inside the image. imagine you are telling a story set in the image.
- "political_state": a short, neutral description that fits the image (e.g., "communal eco-city", "technocratic meritocracy").
- "tags": up to 12 short tags (nouns/adjectives; no hashtags/emojis).
- "vibe": up to 3 mood words.
- "objects": up to 8 concrete things visible.
- "scenes": up to 4 scene/place words.
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
      model: "gpt-4-turbo",
      messages: visionMessages,
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    const raw = vision.choices[0]?.message?.content ?? "{}";

    console.log("has json analysis:" + raw);

    let ai: any = {};
    try {
      ai = JSON.parse(raw);
    } catch {
      // leave ai as {}
    }

    const payload = {
      title: String(ai?.title ?? title ?? "").trim(),
      caption: String(ai?.caption ?? "").trim(),
      altText: String(ai?.altText ?? "").trim(),
      extended_story: String(ai?.extended_story ?? "").trim(),
      political_state: String(ai?.political_state ?? "").trim(),
      tags: Array.isArray(ai?.tags) ? ai.tags.map(String) : [],
      vibe: Array.isArray(ai?.vibe) ? ai.vibe.map(String) : [],
      objects: Array.isArray(ai?.objects) ? ai.objects.map(String) : [],
      scenes: Array.isArray(ai?.scenes) ? ai.scenes.map(String) : [],
    };

    const mergedTags = dedupLower([
      ...payload.tags,
      ...payload.vibe,
      ...payload.objects,
      ...payload.scenes,
    ]).slice(0, 25);

    // Combine user-provided tags string if present
    const userTags = String(tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const finalTags = dedupLower([...mergedTags, ...userTags]);

    console.log("has tags:" + finalTags);

    // 6) Enrich the uploaded asset with tags/context
    await cloudinary.uploader.explicit(uploadResult.public_id, {
      type: "upload",
      tags: finalTags.join(","),
      context: {
        caption: title || remixedPrompt,
        alt: payload.altText,
        ai_title: payload.title,
        ai_political_state: payload.political_state,
        ai_vibe: (payload.vibe || []).join(", "),
        ai_objects: (payload.objects || []).slice(0, 5).join(", "),
        ai_scenes: (payload.scenes || []).join(", "),
        ai_extended_story: payload.extended_story,
        parentIds: parentIds != null ? String(parentIds) : "",
      },
    });

    console.log("does upload");

    // 7) Return everything the client likely needs (including the remixed prompt)
    return NextResponse.json({
      prompt,
      adjectives,
      remixedPrompt,
      // image returned from OpenAI (if you still want it)
      openaiImageUrl: remoteUrl ?? null,
      // cloudinary data
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      folder,
      // ai metadata
      title: title || remixedPrompt,
      alt: payload.altText,
      ai_title: payload.title,
      ai_political_state: payload.political_state,
      ai_vibe: (payload.vibe || []).join(", "),
      ai_objects: (payload.objects || []).slice(0, 5).join(", "),
      ai_scenes: (payload.scenes || []).join(", "),
      ai_extended_story: payload.extended_story,
      tags: finalTags,
      parentIds: parentIds ?? null,
    });
  } catch (error) {
    console.error("Generate+Upload error:", error);
    return NextResponse.json(
      { error: "Failed to generate and upload image" },
      { status: 500 }
    );
  }
}
