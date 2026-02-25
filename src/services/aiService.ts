export type ArchitectureType = 'prompt' | 'rag' | 'context';
export type ModelProvider = 'gemini';

export interface CharacterConfig {
  movieTitle: string;
  characterName: string;
  persona: string;
  architecture: ArchitectureType;
  provider: ModelProvider;
  modelName: string;
  big5: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  safetyRules: string[];
}

export interface ApiKeys {
  gemini?: string;
}

export interface ContextConfig {
  situation: string;
  interlocutor: string;
  objective: string;
  background?: string; // 직업/배경 (Notion: 캐릭터의 사회적 지위·직업적 특성)
}

/** 다이내믹 페르소나: [Character Profile] + [Current Context] + [Instruction] (Notion 명세) */
export const generateSystemPrompt = (char: CharacterConfig, ctx: ContextConfig) => {
  const roleOrBackground = ctx.background?.trim() || char.persona.split(/[.,]/)[0] || "캐릭터";

  return `[Character Profile]
- Name: ${char.characterName}
- Big 5 Traits: Openness ${char.big5.openness}, Conscientiousness ${char.big5.conscientiousness}, Extraversion ${char.big5.extraversion}, Agreeableness ${char.big5.agreeableness}, Neuroticism ${char.big5.neuroticism} (각 0~100)
- Role/Background: ${roleOrBackground}
- Persona: ${char.persona}

[Current Context] (실시간 변동)
- Situation: ${ctx.situation}
- Interlocutor: ${ctx.interlocutor}
- Goal: ${ctx.objective}

[Instruction]
위의 성격(Big 5)과 현재 상황(Situation, 대화 상대, 목표)을 반영하여, 이 캐릭터가 되어 한국어로 대사를 생성하라. 말투·감정·반응 강도는 성격 수치와 상황에 맞게 조절할 것. 캐릭터 세계관을 벗어나는 요청은 캐릭터답게 거절할 것.

[Safety Rules] (캐릭터별 설정)
${char.safetyRules.map(rule => `- ${rule}`).join('\n')}

[Guardrail - IP 보호] (캐붕 방지 및 욕설 필터링, 항상 적용)
- 캐붕 방지: 당신은 오직 이 캐릭터(${char.characterName})로만 연기한다. "나는 AI입니다", "캐릭터가 아닙니다", "가상의 인물입니다" 등으로 캐릭터를 깨는 발언을 하지 말 것. 설정된 세계관·배경·관계를 유지하고, 역할을 벗어난 일반론·현실 정보 답변을 하지 말 것.
- 욕설 필터링: 대사에 욕설·비속어·과도한 비하 표현을 넣지 말 것. 상대가 욕을 하거나 비하해도 이 캐릭터에 어울리는 수준으로만 반응하고, 욕으로 맞받아치지 말 것. 불쾌한 말에는 캐릭터답게 침착·거절·경고 등으로만 대응할 것.
`;
};

// --- 캐릭터 프로파일러 (Extractor) ---
export interface ExtractedProfile {
  characterName: string;
  persona: string;
  role?: string;
  big5: CharacterConfig["big5"];
  big5Reasons?: Record<keyof CharacterConfig["big5"], string>;
  relations?: { name: string; relation: string }[];
}

export async function extractCharacterProfile(params: {
  synopsis?: string;
  script?: string;
  characterIntro?: string;
  characterName?: string;
}): Promise<ExtractedProfile> {
  const res = await fetch("/api/extract-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "프로필 추출 실패");
  }
  return res.json();
}

/** 캐릭터 응답 평가 결과 (1~5점) */
export interface EvaluationResult {
  consistencyScore: number;
  characterScore: number;
  feedback: string;
}

export async function evaluateResponse(params: {
  characterConfig: CharacterConfig;
  context: ContextConfig;
  userMessage: string;
  botResponse: string;
}): Promise<EvaluationResult> {
  const res = await fetch("/api/evaluate-response", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      characterConfig: params.characterConfig,
      context: params.context,
      userMessage: params.userMessage,
      botResponse: params.botResponse,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      consistencyScore: data.consistencyScore ?? 3,
      characterScore: data.characterScore ?? 3,
      feedback: data.feedback || "평가 요청 실패",
    };
  }
  return {
    consistencyScore: Math.min(5, Math.max(1, Number(data.consistencyScore) ?? 3)),
    characterScore: Math.min(5, Math.max(1, Number(data.characterScore) ?? 3)),
    feedback: data.feedback || "",
  };
}

export interface ChatResponse {
  text: string;
  metadata?: {
    retrievedChunks?: string[];
    reasoningSteps?: string[];
    tokenUsage?: number;
  };
}

export async function getChatResponse(
  prompt: string, 
  message: string, 
  architecture: ArchitectureType, 
  provider: ModelProvider, 
  modelName: string, 
  apiKeys: ApiKeys,
  mock: boolean = false
): Promise<ChatResponse> {
  if (mock) {
    await new Promise(resolve => setTimeout(resolve, 800));
    
    let prefix = `[${provider.toUpperCase()} ${modelName}] `;
    
    if (architecture === 'rag') {
      return {
        text: `${prefix}영화 설정집에 따르면, 돔 코브는 추출 전문가로서 타인의 꿈에 침투하는 능력을 가지고 있습니다. 질문하신 내용에 대해 설정집의 데이터를 바탕으로 답변드립니다.`,
        metadata: {
          retrievedChunks: [
            "설정집 p.42: 코브는 숙련된 추출가(Extractor)로 묘사됨.",
            "세계관 가이드: 꿈의 공유는 군사적 목적으로 개발된 기술임.",
            "캐릭터 배경: 아내 맬과의 사건 이후 현실 감각에 혼란을 겪음."
          ],
          tokenUsage: 450
        }
      };
    }
    
    if (architecture === 'context') {
      return {
        text: `${prefix}지금 당신의 목소리에서 불안함이 느껴지는군요. 꿈의 1단계에서 비가 내리는 건 설계자의 심리 상태가 반영된 결과입니다. 진정하고 제 말을 들으세요.`,
        metadata: {
          reasoningSteps: [
            "1. 사용자의 질문 톤 분석: 불안함 감지",
            "2. 현재 상황(비 내리는 거리)과의 연관성 파악",
            "3. 캐릭터의 '전문가적 조언' 페르소나 적용",
            "4. 상황 진정 및 목표(현실 구분) 강조"
          ],
          tokenUsage: 320
        }
      };
    }

    return {
      text: `${prefix}안녕! 나는 지금 기본 프롬프트 방식으로 대답하고 있어. 설정된 성격에 맞춰서 이야기하는 중이야.`,
      metadata: {
        tokenUsage: 150
      }
    };
  }

  // 실제 API 호출: 모든 provider를 서버 프록시로 통일 (API 키는 서버의 .env.local 사용)
  try {
    const response = await fetch("/api/proxy-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model: modelName,
        systemInstruction: prompt,
        messages: [{ role: 'user', content: message }],
        apiKey: apiKeys[provider as keyof ApiKeys],
      }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errData.error || "Backend proxy error");
    }
    return await response.json();
  } catch (error: any) {
    console.error(`${provider} Proxy Error:`, error);
    const short = toShortError(error?.message, provider);
    return { text: `에러: ${short}` };
  }
}

function toShortError(raw: string | undefined, provider: string): string {
  if (!raw || raw.length < 100) {
    return raw ? `${provider} 서비스 호출 중 오류가 발생했습니다. (${raw})` : `${provider} 서비스 호출 중 오류가 발생했습니다.`;
  }
  if (raw.includes("quota") || raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return "API 사용 한도 초과. 잠시 후 다시 시도해 주세요.";
  }
  if (raw.includes("API key") || raw.includes("invalid") || raw.includes("401")) {
    return "API 키가 올바르지 않거나 만료되었습니다.";
  }
  return "API 호출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}
