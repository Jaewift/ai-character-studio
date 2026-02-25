import express from "express";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
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

  // API Routes
  app.post("/api/proxy-chat", async (req, res) => {
    const { provider: rawProvider, model, messages, systemInstruction, apiKey } = req.body;
    let provider = typeof rawProvider === "string" ? rawProvider.toLowerCase().trim() : rawProvider;
    if (!provider && typeof model === "string" && model.toLowerCase().startsWith("gemini")) {
      provider = "gemini";
    }

    console.log(`Proxying request to ${provider} (${model})`);

    try {
      if (provider === "gemini") {
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
      }

      if (provider === 'openai' || provider === 'nvidia') {
        const client = new OpenAI({
          apiKey: apiKey || (provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.NVIDIA_API_KEY),
          baseURL: provider === 'nvidia' ? "https://integrate.api.nvidia.com/v1" : undefined
        });

        const response = await client.chat.completions.create({
          model: model,
          messages: [
            { role: "system", content: systemInstruction },
            ...messages
          ],
        });

        return res.json({ 
          text: response.choices[0].message.content,
          metadata: { tokenUsage: response.usage?.total_tokens }
        });
      }

      if (provider === "anthropic") {
        const client = new Anthropic({
          apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        });

        const response = await client.messages.create({
          model: model,
          max_tokens: 1024,
          system: systemInstruction,
          messages: messages,
        });

        return res.json({ 
          text: response.content[0].type === 'text' ? response.content[0].text : "Non-text response",
          metadata: { tokenUsage: response.usage.input_tokens + response.usage.output_tokens }
        });
      }

      res.status(400).json({
        error: `Unsupported provider: "${provider}" (지원: gemini, openai, anthropic, nvidia)`,
      });
    } catch (error: any) {
      console.error(`Error calling ${provider}:`, error);
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
