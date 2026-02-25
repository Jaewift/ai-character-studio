import { GoogleGenAI } from "@google/genai";

export const config = {
  maxDuration: 60,
};

export async function POST(request: Request) {
  let body: {
    synopsis?: string;
    script?: string;
    characterIntro?: string;
    characterName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { synopsis = "", script = "", characterIntro = "", characterName: targetName = "" } = body;
  const text = [synopsis, script, characterIntro].filter(Boolean).join("\n\n---\n\n");
  if (!text.trim()) {
    return Response.json(
      { error: "시놉시스, 대본, 또는 캐릭터 소개 중 하나 이상을 입력해 주세요." },
      { status: 400 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "GEMINI_API_KEY가 설정되지 않았습니다. Vercel 대시보드에서 Environment Variables에 설정하세요." },
      { status: 500 }
    );
  }

  const prompt = `다음 영화/드라마 자료를 분석하여, ${targetName ? `'${targetName}'` : "주요 등장인물(주인공 우선)"}의 캐릭터 프로필을 추출하세요.

[자료]
${text}

다음 JSON 형식으로만 응답하세요. 다른 설명은 붙이지 마세요.
{
  "characterName": "캐릭터 이름",
  "persona": "한 줄 요약 (역할, 성격, 배경)",
  "role": "직업/배경 (예: 강력반 형사, 추출 전문가)",
  "big5": {
    "openness": 0~100,
    "conscientiousness": 0~100,
    "extraversion": 0~100,
    "agreeableness": 0~100,
    "neuroticism": 0~100
  },
  "big5Reasons": {
    "openness": "해당 수치의 근거 한 줄",
    "conscientiousness": "해당 수치의 근거 한 줄",
    "extraversion": "해당 수치의 근거 한 줄",
    "agreeableness": "해당 수치의 근거 한 줄",
    "neuroticism": "해당 수치의 근거 한 줄"
  },
  "relations": [
    { "name": "다른 인물 이름", "relation": "이 캐릭터와의 관계 설명" }
  ]
}`;

  const modelsToTry = ["gemini-2.0-flash", "gemini-2.5-flash"];
  let lastError: unknown = null;

  for (const model of modelsToTry) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.3,
        },
      });
      let raw = response.text?.trim() || "{}";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) raw = jsonMatch[0];
      const parsed = JSON.parse(raw);
      return Response.json(parsed);
    } catch (e: unknown) {
      lastError = e;
      const errStr = String((e as Error)?.message ?? e ?? "");
      const is429 = errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED") || errStr.includes("quota");
      if (is429 && modelsToTry.indexOf(model) < modelsToTry.length - 1) continue;
      break;
    }
  }
  const message = lastError instanceof Error ? lastError.message : "프로필 추출 중 오류가 발생했습니다.";
  console.error("Extract profile error:", lastError);
  return Response.json(
    { error: message, hint: "무료 한도(429)일 수 있습니다. 결제 설정 또는 https://ai.google.dev/gemini-api/docs/rate-limits 확인하세요." },
    { status: 500 }
  );
}
