import { GoogleGenAI } from "@google/genai";

export const config = {
  maxDuration: 60,
};

export async function POST(request: Request) {
  let body: {
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

  const { model, messages, systemInstruction, apiKey } = body;

  try {
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
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : "Internal Server Error";
    const short = toShortErrorMessage(raw);
    console.error("Error calling Gemini:", error);
    return Response.json({ error: short }, { status: 500 });
  }
}

function toShortErrorMessage(raw: string): string {
  if (!raw || raw.length < 120) return raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
    const msg = parsed?.error?.message ?? parsed?.error?.status ?? "";
    if (typeof msg !== "string") return "API 호출 중 오류가 발생했습니다.";
    if (msg.includes("quota") || msg.includes("429") || parsed?.error?.status === "RESOURCE_EXHAUSTED") {
      return "API 사용 한도 초과. 잠시 후 다시 시도해 주세요.";
    }
    if (msg.includes("API key") || msg.includes("invalid") || msg.includes("401")) {
      return "API 키가 올바르지 않거나 만료되었습니다.";
    }
    const firstLine = msg.split("\n")[0].trim();
    return firstLine.length > 80 ? "API 호출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." : firstLine;
  } catch {
    if (raw.includes("quota") || raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
      return "API 사용 한도 초과. 잠시 후 다시 시도해 주세요.";
    }
    return "API 호출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
}
