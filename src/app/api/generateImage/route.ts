import { NextResponse } from "next/server";

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface GenerationResult {
  sentence: string;
  imageUrl: string;
  trends: string[];
  geo: string;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    let prompt = url.searchParams.get("prompt") || "";
    const adjectives = url.searchParams.get("adjectives") || "";

    console.log("generates image", prompt);

    // // Generate sentence using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `pretend that you are an image prompt engineer that is trying to depict a scene in a world. We need to write an image prompt that expands on and depicts the following sentence: There is... ${prompt}. The world should fit this vibe: ${adjectives} and be in the style of mediaval drawings or post-internet graphics and sci-fi,  please output an image prompt in english`,
        },
      ],
      max_tokens: 100,
    });

    const sentence = completion.choices[0].message.content || "";
    sentence.replace('"', "");

    let styleSuffix =
      "the image should be in the style of mideaval drawings, fantasy, post-internet graphics and sci-fi. the image is not allowed to show any caption or UI element.";

    // Generate image using DALL-E
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

    // uploadToCloudinary(data);

    return NextResponse.json(data);
  } catch (error) {
    console.error("Generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}
