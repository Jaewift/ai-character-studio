import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

export const config = {
  maxDuration: 60,
};

export async function POST(request: Request) {
  let body: {
    provider?: string;
    model?: string;
    messages?: { role: string; content: string }[];
    systemInstruction?: string;
    apiKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { provider: rawProvider, model, messages, systemInstruction, apiKey } = body;
  let provider = typeof rawProvider === "string" ? rawProvider.toLowerCase().trim() : rawProvider;
  if (!provider && typeof model === "string" && model.toLowerCase().startsWith("gemini")) {
    provider = "gemini";
  }

  try {
    if (provider === "gemini") {
      const geminiKey = process.env.GEMINI_API_KEY || apiKey;
      if (!geminiKey) {
        return Response.json(
          { error: "GEMINI_API_KEY가 설정되지 않았습니다. Vercel 대시보드에서 Environment Variables에 설정하세요." },
          { status: 500 }
        );
      }
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const userContent = Array.isArray(messages) && messages.length > 0
        ? (messages[messages.length - 1]?.content ?? "")
        : "";
      const response = await ai.models.generateContent({
        model: model || "gemini-2.0-flash",
        contents: userContent,
        config: {
          systemInstruction: systemInstruction || "",
        },
      });
      const text = response.text?.trim() ?? "대답을 받지 못했습니다.";
      return Response.json({
        text,
        metadata: { tokenUsage: response.usageMetadata?.totalTokenCount ?? 0 },
      });
    }

    if (provider === "openai" || provider === "nvidia") {
      const key = apiKey || (provider === "openai" ? process.env.OPENAI_API_KEY : process.env.NVIDIA_API_KEY);
      if (!key) {
        return Response.json(
          { error: `${provider === "openai" ? "OPENAI_API_KEY" : "NVIDIA_API_KEY"}가 설정되지 않았습니다.` },
          { status: 500 }
        );
      }
      const client = new OpenAI({
        apiKey: key,
        baseURL: provider === "nvidia" ? "https://integrate.api.nvidia.com/v1" : undefined,
      });
      const response = await client.chat.completions.create({
        model: model!,
        messages: [
          { role: "system", content: systemInstruction ?? "" },
          ...(messages ?? []),
        ],
      });
      return Response.json({
        text: response.choices[0].message.content,
        metadata: { tokenUsage: response.usage?.total_tokens },
      });
    }

    if (provider === "anthropic") {
      const key = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) {
        return Response.json(
          { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." },
          { status: 500 }
        );
      }
      const client = new Anthropic({ apiKey: key });
      const response = await client.messages.create({
        model: model!,
        max_tokens: 1024,
        system: systemInstruction ?? "",
        messages: messages ?? [],
      });
      const textContent = response.content[0];
      const text = textContent.type === "text" ? textContent.text : "Non-text response";
      return Response.json({
        text,
        metadata: {
          tokenUsage: response.usage.input_tokens + response.usage.output_tokens,
        },
      });
    }

    return Response.json(
      { error: `Unsupported provider: "${provider}" (지원: gemini, openai, anthropic, nvidia)` },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Error calling", provider, error);
    return Response.json({ error: message }, { status: 500 });
  }
}
