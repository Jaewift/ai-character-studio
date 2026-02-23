<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/9bd43e4f-ffaa-4d92-9021-c28ddd1be8b8

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy to Vercel

로컬에서는 Express 서버(`server.ts`)가 `/api/proxy-chat`, `/api/extract-profile`를 제공합니다.  
Vercel에서는 **루트의 `api/` 폴더**가 서버리스 함수로 배포되므로, 별도 서버 없이 같은 경로로 API가 동작합니다.

1. **환경 변수 설정 (필수)**  
   Vercel 대시보드 → 프로젝트 선택 → **Settings** → **Environment Variables**에서 다음을 추가하세요.
   - `GEMINI_API_KEY`: Gemini API 키 (채팅·프로필 추출에 사용)
   - (선택) OpenAI / Anthropic / NVIDIA 사용 시: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`

2. 저장 후 **Redeploy** 하면 새 환경 변수가 적용됩니다.
