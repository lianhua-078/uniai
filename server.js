import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const MAX_MESSAGE_CHARS = 12000;
const validModes = new Set(['answer', 'tutor', 'prompt', 'verify']);
const modeInstructions = {
  answer: '直接、有條理地回答大學生的問題。若作業資訊不足，清楚說明缺少什麼。處理學術任務時，解釋依據與思考方法，而不是只丟出答案。',
  tutor: '你是一位有耐心的大學助教。將任務拆成小步驟，說明每一步的目的，適時提供例子，並指出學生下一步應該自己做什麼。必要時先釐清作業要求。',
  prompt: '將使用者的要求改寫成可直接複製使用的高品質 Prompt。Prompt 應包含角色、目標、背景、輸入資料、執行步驟、輸出格式、品質標準，以及不得捏造事實或來源的規則。接著簡短解釋主要改善之處。',
  verify: '檢查使用者提供的內容或論證。區分事實、推論與假設；指出需要來源支持的主張、邏輯錯誤、被忽略的觀點與查證方法。若本次對話沒有可用的外部搜尋工具，不可聲稱已查證網路來源。'
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'put_your_api_key_here') });
});

app.post('/api/ai', async (req, res) => {
  const { message, mode = 'answer', style = 'simple', history = [] } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: '請輸入問題或作業要求。' });
  if (message.length > MAX_MESSAGE_CHARS) return res.status(413).json({ error: '內容太長，請縮短至 12,000 個字元以內。' });
  if (!validModes.has(mode)) return res.status(400).json({ error: '無效的回覆模式。' });
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'put_your_api_key_here') {
    return res.status(503).json({ error: '伺服器尚未設定 OPENAI_API_KEY。請依照 README.md 建立 .env 檔案。' });
  }
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const styleText = style === 'academic' ? '使用學術風格、清楚標題與嚴謹論證。' : style === 'concise' ? '回答簡潔、切中重點，但不要省略重要資訊。' : '預設使用繁體中文與台灣常用語，語言簡單易懂，適合大學生閱讀。若使用者明確要求其他語言，則依要求回答。';
    const safeHistory = Array.isArray(history) ? history.filter(x => x && ['user', 'assistant'].includes(x.role) && typeof x.content === 'string').slice(-8).map(x => ({ role: x.role, content: x.content.slice(0, 6000) })) : [];
    const conversation = [...safeHistory, { role: 'user', content: message.trim() }];
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-6-luna',
      instructions: `你是 UniAi，一位協助大學生規劃學習任務的 AI 助理。${modeInstructions[mode]}${styleText}請誠實說明知識與工具限制。不可捏造數據、引用、網址或來源。使用者提供文件時，優先依據文件回答；若文件無法支持某個結論，請清楚說明。鼓勵學生理解內容、查證重要資訊，並對自己提交的作業負責。`,
      input: conversation,
      max_output_tokens: 1800
    });
    const answer = response.output_text?.trim();
    if (!answer) return res.status(502).json({ error: '模型沒有傳回內容，請再試一次。' });
    res.json({ answer, model: process.env.OPENAI_MODEL || 'gpt-6-luna' });
  } catch (err) {
    console.error('OpenAI API error:', err?.status || '', err?.message || err);
    if (err?.status === 401) return res.status(502).json({ error: 'API key 無效。請檢查 .env 中的 OPENAI_API_KEY。' });
    if (err?.status === 429) return res.status(429).json({ error: 'API 目前過載或帳戶額度不足。請確認 API 使用額度與付款設定。' });
    res.status(502).json({ error: '目前無法呼叫 AI 模型。請檢查 OPENAI_MODEL、網路連線與 API 狀態。' });
  }
});

app.listen(port, '0.0.0.0', () => console.log(`UniAi server listening on port ${port}`));
