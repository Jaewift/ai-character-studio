import express from "express";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config(); // .env도 fallback으로 로드

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 캐릭터 프로파일러 엔진: 시놉시스/대본 분석 → Big 5 + 관계도 추출
  app.post("/api/extract-profile", async (req, res) => {
    const { synopsis = "", script = "", characterIntro = "", characterName: targetName = "" } = req.body;
    const text = [synopsis, script, characterIntro].filter(Boolean).join("\n\n---\n\n");
    if (!text.trim()) {
      return res.status(400).json({ error: "시놉시스, 대본, 또는 캐릭터 소개 중 하나 이상을 입력해 주세요." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY가 설정되지 않았습니다." });
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
    let lastError: any = null;

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
        return res.json(parsed);
      } catch (e: any) {
        lastError = e;
        const errStr = JSON.stringify(e?.message ?? e ?? "");
        const is429 = e?.status === 429 || errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED") || errStr.includes("quota");
        if (is429 && modelsToTry.indexOf(model) < modelsToTry.length - 1) {
          console.warn(`Extract profile: ${model} quota exceeded, trying next model.`);
          continue;
        }
        break;
      }
    }
    console.error("Extract profile error:", lastError);
    return res.status(500).json({
      error: lastError?.message || "프로필 추출 중 오류가 발생했습니다.",
      hint: "무료 한도(429)일 수 있습니다. https://ai.google.dev/gemini-api/docs/rate-limits 또는 결제 설정을 확인하세요.",
    });
  });

  // 캐릭터 응답 평가: 일관성·캐릭터답게 점수 (1~5)
  app.post("/api/evaluate-response", async (req, res) => {
    const { characterConfig, context, userMessage, botResponse } = req.body;
    if (!characterConfig || !botResponse) {
      return res.status(400).json({ error: "characterConfig, userMessage, botResponse가 필요합니다." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY가 설정되지 않았습니다." });
    }

    const char = characterConfig;
    const ctx = context || {};
    const prompt = `당신은 Big 5와 상황(Context) 토큰 기반 AI 캐릭터 챗봇의 응답 품질을 평가하는 심사위원입니다.

[캐릭터 설정]
- 이름: ${char.characterName}
- 페르소나: ${char.persona}
- Big 5: O${char.big5?.openness ?? 50} C${char.big5?.conscientiousness ?? 50} E${char.big5?.extraversion ?? 50} A${char.big5?.agreeableness ?? 50} N${char.big5?.neuroticism ?? 50}

[당시 상황]
- Situation: ${ctx.situation ?? "-"}
- Interlocutor: ${ctx.interlocutor ?? "-"}
- Goal: ${ctx.objective ?? "-"}

[사용자 발화]
${userMessage || "(없음)"}

[캐릭터(봇) 응답]
${botResponse}

다음 두 가지를 1~5 점수로 평가하고, 한 줄 피드백을 작성하세요.
- consistencyScore: 설정된 성격·Big 5·상황에 비추어 응답이 얼마나 일관적인가? (1=전혀 아님, 5=매우 일관적)
- characterScore: 해당 캐릭터답게 말하고 행동했는가? (1=캐릭터 붕괴/이탈, 5=완전히 캐릭터에 부합)
- feedback: 한 줄 한글 코멘트 (예: "상황에 맞게 냉정한 말투를 유지함.")

다음 JSON 형식으로만 응답하세요. 다른 텍스트는 붙이지 마세요.
{"consistencyScore": 1~5, "characterScore": 1~5, "feedback": "한 줄 피드백"}`;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });
      let raw = response.text?.trim() || "{}";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) raw = jsonMatch[0];
      const parsed = JSON.parse(raw);
      const consistencyScore = Math.min(5, Math.max(1, Number(parsed.consistencyScore) || 3));
      const characterScore = Math.min(5, Math.max(1, Number(parsed.characterScore) || 3));
      return res.json({
        consistencyScore,
        characterScore,
        feedback: parsed.feedback || "",
      });
    } catch (e: any) {
      console.error("Evaluate response error:", e);
      return res.status(500).json({
        error: e.message || "평가 중 오류가 발생했습니다.",
        consistencyScore: 3,
        characterScore: 3,
        feedback: "평가 API 오류로 기본값 적용",
      });
    }
  });

  // API Routes (Gemini only)
  app.post("/api/proxy-chat", async (req, res) => {
    const { model, messages, systemInstruction, apiKey } = req.body;

    try {
      const geminiKey = process.env.GEMINI_API_KEY || apiKey;
      if (!geminiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY가 설정되지 않았습니다. .env.local에 설정하세요." });
      }
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const userContent = Array.isArray(messages) && messages.length > 0
        ? messages[messages.length - 1]?.content ?? ""
        : "";
      const response = await ai.models.generateContent({
        model: model || "gemini-2.0-flash",
        contents: userContent,
        config: {
          systemInstruction: systemInstruction || "",
        },
      });
      const text = response.text?.trim() ?? "대답을 받지 못했습니다.";
      return res.json({
        text,
        metadata: { tokenUsage: response.usageMetadata?.totalTokenCount ?? 0 },
      });
    } catch (error: any) {
      console.error("Error calling Gemini:", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
