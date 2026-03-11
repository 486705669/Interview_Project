import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  callDeepSeekCareAgent,
  type AgentToolCall,
  type AgentToolResult
} from "./agent.js";
import cors from "cors";
import express, { type Request, type Response } from "express";

type Role = "user" | "assistant";
type ReminderStatus = "pending" | "done" | "snooze" | "skip";
type EmergencySource = "keyword" | "manual";
type EmergencyStatus = "open" | "resolved";
type AsrProvider = "disabled" | "aliyun-nls" | "openai";

interface ChatMessage {
  id: number;
  role: Role;
  text: string;
  createdAt: string;
  risk?: boolean;
}

interface Reminder {
  id: number;
  title: string;
  time: string;
  status: ReminderStatus;
}

interface EmergencyEvent {
  id: number;
  source: EmergencySource;
  triggerText: string;
  createdAt: string;
  status: EmergencyStatus;
  actionLog: string[];
}

interface CareNote {
  id: number;
  summary: string;
  category: "symptom" | "habit" | "mood" | "safety";
  level: "normal" | "warning";
  createdAt: string;
}

interface FamilyTimelineItem {
  id: string;
  type: "chat" | "reminder" | "emergency" | "record";
  title: string;
  description: string;
  createdAt: string;
  level: "normal" | "warning";
}

interface VoiceCapabilities {
  enabled: boolean;
  provider: AsrProvider;
  note: string;
}

interface AliyunTokenState {
  value: string;
  expireTime: number;
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDistDir =
  process.env.FRONTEND_DIST_DIR ?? path.resolve(currentDir, "../../frontend/dist");
const hasFrontendBuild = fs.existsSync(frontendDistDir);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() ?? "";
const OPENAI_TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
const ALIYUN_NLS_APPKEY = process.env.ALIYUN_NLS_APPKEY?.trim() ?? "";
const ALIYUN_NLS_TOKEN = process.env.ALIYUN_NLS_TOKEN?.trim() ?? "";
const ALIYUN_AK_ID =
  process.env.ALIYUN_AK_ID?.trim() ?? process.env.ALIYUN_ACCESS_KEY_ID?.trim() ?? "";
const ALIYUN_AK_SECRET =
  process.env.ALIYUN_AK_SECRET?.trim() ?? process.env.ALIYUN_ACCESS_KEY_SECRET?.trim() ?? "";
const ALIYUN_NLS_REGION = process.env.ALIYUN_NLS_REGION?.trim() || "cn-shanghai";
const hasAliyunAutoToken = Boolean(ALIYUN_NLS_APPKEY && ALIYUN_AK_ID && ALIYUN_AK_SECRET);
const ALIYUN_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const voiceCapabilities = resolveVoiceCapabilities();
const messages: ChatMessage[] = [];
const reminders: Reminder[] = [];
const emergencies: EmergencyEvent[] = [];
const careNotes: CareNote[] = [];

let messageId = 1;
let reminderId = 1;
let emergencyId = 1;
let careNoteId = 1;
let aliyunTokenState: AliyunTokenState | null =
  !hasAliyunAutoToken && ALIYUN_NLS_TOKEN
    ? {
        value: ALIYUN_NLS_TOKEN,
        expireTime: Number.MAX_SAFE_INTEGER
      }
    : null;
let aliyunTokenRefreshPromise: Promise<AliyunTokenState> | null = null;

const riskKeywordFragments = [
  "胸痛",
  "胸口痛",
  "呼吸困难",
  "喘不上气",
  "晕倒",
  "昏迷",
  "剧烈头痛",
  "肚子痛得厉害",
  "心慌",
  "chest pain",
  "shortness of breath",
  "fainted"
];

const riskPatterns: RegExp[] = [
  /胸.*痛/u,
  /胸口.*痛/u,
  /呼吸.*困难/u,
  /喘不上气/u,
  /晕倒/u,
  /昏迷/u,
  /头.*剧烈.*痛/u,
  /肚子.*痛.*厉害/u,
  /心慌/u,
  /chest\s*pain/i,
  /shortness\s*of\s*breath/i
];

function resolveVoiceCapabilities(): VoiceCapabilities {
  if (ALIYUN_NLS_APPKEY && (hasAliyunAutoToken || ALIYUN_NLS_TOKEN)) {
    return {
      enabled: true,
      provider: "aliyun-nls",
      note: hasAliyunAutoToken
        ? "按住说话，松开后上传到服务器识别。当前使用阿里云语音识别，Token 会在服务端自动刷新。"
        : "按住说话，松开后上传到服务器识别。当前使用阿里云语音识别。"
    };
  }

  if (OPENAI_API_KEY) {
    return {
      enabled: true,
      provider: "openai",
      note: "按住说话，松开后上传到服务器识别。当前使用 OpenAI 语音识别。"
    };
  }

  return {
    enabled: false,
    provider: "disabled",
    note: "服务器还没有配置服务端语音识别，请先用打字。"
  };
}

function aliyunPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

function buildAliyunCanonicalQuery(parameters: Record<string, string>): string {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${aliyunPercentEncode(key)}=${aliyunPercentEncode(parameters[key] ?? "")}`)
    .join("&");
}

async function readResponseJson<T>(response: globalThis.Response): Promise<T> {
  const text = await response.text();
  return JSON.parse(text) as T;
}

async function requestAliyunAccessToken(): Promise<AliyunTokenState> {
  const parameters: Record<string, string> = {
    AccessKeyId: ALIYUN_AK_ID,
    Action: "CreateToken",
    Format: "JSON",
    RegionId: ALIYUN_NLS_REGION,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString(),
    Version: "2019-02-28"
  };
  const canonicalQuery = buildAliyunCanonicalQuery(parameters);
  const stringToSign = `GET&${aliyunPercentEncode("/")}&${aliyunPercentEncode(canonicalQuery)}`;
  const signature = crypto
    .createHmac("sha1", `${ALIYUN_AK_SECRET}&`)
    .update(stringToSign)
    .digest("base64");
  const requestUrl =
    `https://nls-meta.${ALIYUN_NLS_REGION}.aliyuncs.com/?Signature=` +
    `${aliyunPercentEncode(signature)}&${canonicalQuery}`;
  const response = await fetch(requestUrl);
  const data = await readResponseJson<{
    Token?: { Id?: string; ExpireTime?: number };
    Message?: string;
    Code?: string;
  }>(response);

  if (!response.ok || !data.Token?.Id || !data.Token.ExpireTime) {
    throw new Error(data.Message || data.Code || `阿里云 Token 获取失败（${response.status}）`);
  }

  return {
    value: data.Token.Id,
    expireTime: Number(data.Token.ExpireTime) * 1000
  };
}

function isAliyunTokenFresh(tokenState: AliyunTokenState | null): boolean {
  if (!tokenState) {
    return false;
  }

  return tokenState.expireTime - Date.now() > ALIYUN_TOKEN_REFRESH_BUFFER_MS;
}

async function getAliyunNlsToken(): Promise<string> {
  if (hasAliyunAutoToken) {
    const currentTokenState = aliyunTokenState;
    if (currentTokenState && isAliyunTokenFresh(currentTokenState)) {
      return currentTokenState.value;
    }

    if (!aliyunTokenRefreshPromise) {
      aliyunTokenRefreshPromise = requestAliyunAccessToken();
    }

    try {
      aliyunTokenState = await aliyunTokenRefreshPromise;
      return aliyunTokenState.value;
    } finally {
      aliyunTokenRefreshPromise = null;
    }
  }

  if (aliyunTokenState?.value) {
    return aliyunTokenState.value;
  }

  throw new Error("阿里云语音识别未配置可用的 Token 或 AccessKey。");
}

function detectRisk(text: string): boolean {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  return (
    riskKeywordFragments.some((part) => normalized.includes(part.toLowerCase())) ||
    riskPatterns.some((pattern) => pattern.test(normalized))
  );
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function isQuestion(text: string): boolean {
  return /[?？]$/.test(text) || /怎么|如何|为什么|几点|多少|在哪|什么/.test(text);
}

function extractTopic(text: string): string {
  const normalized = text.replace(/[，。！？,.!?]/g, " ").trim();
  if (!normalized) {
    return "这件事";
  }

  return normalized.slice(0, 18);
}

function buildReply(text: string, risk: boolean): string {
  const normalized = text.replace(/\s+/g, "").toLowerCase();

  if (risk) {
    return "我听到您可能有紧急不适。请优先拨打 120，或立即联系紧急联系人。如果您还能说话，可以告诉我现在最难受的感觉是什么。";
  }

  if (includesAny(normalized, ["你好", "您好", "在吗", "早上好", "晚上好"])) {
    return "您好，我在这里。您想聊聊天、设个提醒，还是说说现在身体哪里不舒服？";
  }

  if (includesAny(normalized, ["你是谁", "你叫什么", "你是干嘛的"])) {
    return "我是老人陪伴助手。我现在主要能陪您聊天、帮您记提醒、记录关键情况，遇到风险时优先引导求助。";
  }

  if (
    includesAny(normalized, ["你会做什么", "你能做什么", "能帮我什么", "怎么用", "帮助", "功能"])
  ) {
    return "我现在最擅长四件事：陪您聊天、帮您设提醒、记录重要情况、遇到危险时引导您求助。您想先聊天，还是先设个提醒？";
  }

  if (includesAny(normalized, ["提醒", "吃药", "喝水", "复诊", "闹钟", "记得"])) {
    return "可以。我能帮您记吃药、喝水、复诊这些提醒。您可以直接告诉我时间和事情，也可以去提醒页手动新增。";
  }

  if (includesAny(normalized, ["孤单", "孤独", "无聊", "难过", "烦", "陪我聊", "想聊天"])) {
    return "听起来您现在需要有人陪您说说话。我在这里。您最想聊的是家里人、身体情况，还是今天发生的事？";
  }

  if (includesAny(normalized, ["谢谢", "麻烦你", "辛苦了"])) {
    return "不客气。我会继续陪着您。您还想聊聊，还是需要我帮您设个提醒？";
  }

  if (includesAny(normalized, ["睡不着", "失眠", "睡不好"])) {
    return "晚上睡不着会很难受。我不做医疗诊断，但您可以先试试放慢呼吸、喝点温水、少看刺激内容。如果您愿意，我可以先陪您聊一会儿。";
  }

  if (
    includesAny(normalized, [
      "头疼",
      "头痛",
      "肚子疼",
      "胃不舒服",
      "咳嗽",
      "发烧",
      "鼻塞",
      "乏力",
      "腿疼",
      "腰酸"
    ])
  ) {
    return "听起来您身体有些不舒服。我不能直接做医疗诊断，但建议您先休息、喝点温水，留意症状有没有加重。如果同时出现胸痛、呼吸困难、晕倒或症状明显加重，请立即求助。";
  }

  if (includesAny(normalized, ["家人", "儿子", "女儿", "孙子", "孙女", "老伴", "家里人"])) {
    return "您提到家里人了。是想聊聊他们，还是想记一件稍后要告诉家属的事情？";
  }

  if (includesAny(normalized, ["天气", "下雨", "温度", "新闻", "今天发生什么"])) {
    return "我这个版本暂时不直接查实时天气和新闻。如果您是担心出门、穿衣、带伞这类问题，我可以先陪您拆解要做什么准备。";
  }

  if (isQuestion(text)) {
    return `我明白您在问“${extractTopic(text)}”。就这个版本来说，我更擅长陪聊、提醒和安全求助。您是想让我直接帮您做下一步，还是先和我说说您担心的点？`;
  }

  return `我听到您在说“${extractTopic(text)}”。这件事更像是让您担心、身体不舒服，还是只是想找人聊聊？`;
}

function addChat(role: Role, text: string, risk = false): void {
  messages.push({
    id: messageId++,
    role,
    text,
    createdAt: new Date().toISOString(),
    risk
  });
}

function createEmergency(source: EmergencySource, triggerText: string): EmergencyEvent {
  const event: EmergencyEvent = {
    id: emergencyId++,
    source,
    triggerText,
    createdAt: new Date().toISOString(),
    status: "open",
    actionLog: ["创建事件"]
  };
  emergencies.unshift(event);
  return event;
}

function createCareNote(
  summary: string,
  options?: Partial<Pick<CareNote, "category" | "level">>
): CareNote {
  const note: CareNote = {
    id: careNoteId++,
    summary,
    category: options?.category ?? "symptom",
    level: options?.level ?? "normal",
    createdAt: new Date().toISOString()
  };
  careNotes.unshift(note);
  return note;
}

function buildAgentContext(userMessage: string, heuristicRisk: boolean) {
  return {
    nowIso: new Date().toISOString(),
    userMessage,
    recentMessages: messages.slice(-12).map((item) => ({
      role: item.role,
      text: item.text,
      createdAt: item.createdAt
    })),
    reminders: reminders.slice(0, 10).map((item) => ({
      title: item.title,
      time: item.time,
      status: item.status
    })),
    emergencies: emergencies.slice(0, 6).map((item) => ({
      triggerText: item.triggerText,
      status: item.status,
      createdAt: item.createdAt
    })),
    notes: careNotes.slice(0, 10).map((item) => ({
      summary: item.summary,
      level: item.level,
      category: item.category,
      createdAt: item.createdAt
    })),
    heuristicRisk
  };
}

function executeAgentToolCalls(toolCalls: AgentToolCall[], fallbackMessage: string) {
  const toolResults: AgentToolResult[] = [];
  let createdEmergency = false;

  for (const toolCall of toolCalls.slice(0, 4)) {
    if (toolCall.name === "create_reminder") {
      const title = String(toolCall.arguments.title ?? "").trim();
      const time = String(toolCall.arguments.time ?? "").trim();
      const parsedTime = new Date(time);

      if (!title || !time || Number.isNaN(parsedTime.getTime())) {
        continue;
      }

      reminders.unshift({
        id: reminderId++,
        title,
        time: parsedTime.toISOString(),
        status: "pending"
      });
      toolResults.push({
        toolCallId: toolCall.id,
        name: "create_reminder",
        content: JSON.stringify({
          ok: true,
          title,
          time: parsedTime.toISOString(),
          message: `已添加提醒：${title}`
        })
      });
      continue;
    }

    if (toolCall.name === "create_emergency") {
      const triggerText = String(toolCall.arguments.triggerText ?? fallbackMessage).trim();
      const actionText = String(toolCall.arguments.actionText ?? "模型判定需要重点关注").trim();
      const event = createEmergency("keyword", triggerText || fallbackMessage);
      event.actionLog.push(actionText);
      toolResults.push({
        toolCallId: toolCall.id,
        name: "create_emergency",
        content: JSON.stringify({
          ok: true,
          eventId: event.id,
          triggerText: event.triggerText,
          message: "已记录紧急事件"
        })
      });
      createdEmergency = true;
      continue;
    }

    if (toolCall.name === "record_note") {
      const summary = String(toolCall.arguments.summary ?? "").trim();
      const level = toolCall.arguments.level === "warning" ? "warning" : "normal";
      const category =
        toolCall.arguments.category === "habit" ||
        toolCall.arguments.category === "mood" ||
        toolCall.arguments.category === "safety"
          ? toolCall.arguments.category
          : "symptom";

      if (!summary) {
        continue;
      }

      createCareNote(summary, {
        level,
        category
      });
      toolResults.push({
        toolCallId: toolCall.id,
        name: "record_note",
        content: JSON.stringify({
          ok: true,
          summary,
          level,
          category,
          message: `已记录：${summary}`
        })
      });
    }
  }

  return {
    toolResults,
    createdEmergency
  };
}

function buildFamilyTimeline(): FamilyTimelineItem[] {
  const chatItems: FamilyTimelineItem[] = messages.slice(-40).map((item) => ({
    id: `chat-${item.id}`,
    type: "chat",
    title: item.role === "user" ? "用户对话" : "助手回复",
    description: item.text,
    createdAt: item.createdAt,
    level: item.risk ? "warning" : "normal"
  }));

  const reminderItems: FamilyTimelineItem[] = reminders.map((item) => ({
    id: `reminder-${item.id}`,
    type: "reminder",
    title: "提醒事项",
    description: `${item.title} / ${item.status}`,
    createdAt: item.time,
    level: item.status === "pending" ? "warning" : "normal"
  }));

  const emergencyItems: FamilyTimelineItem[] = emergencies.map((item) => ({
    id: `emergency-${item.id}`,
    type: "emergency",
    title: "紧急事件",
    description: item.triggerText,
    createdAt: item.createdAt,
    level: "warning"
  }));

  const recordItems: FamilyTimelineItem[] = careNotes.map((item) => ({
    id: `record-${item.id}`,
    type: "record",
    title: "健康记录",
    description: item.summary,
    createdAt: item.createdAt,
    level: item.level
  }));

  return [...chatItems, ...reminderItems, ...emergencyItems, ...recordItems].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

async function transcribeWithAliyunNls(audioBuffer: Buffer): Promise<string> {
  const token = await getAliyunNlsToken();
  const url = new URL(`https://nls-gateway-${ALIYUN_NLS_REGION}.aliyuncs.com/stream/v1/asr`);
  url.searchParams.set("appkey", ALIYUN_NLS_APPKEY);
  url.searchParams.set("format", "wav");
  url.searchParams.set("sample_rate", "16000");
  url.searchParams.set("enable_punctuation_prediction", "true");
  url.searchParams.set("enable_inverse_text_normalization", "true");
  url.searchParams.set("enable_voice_detection", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-NLS-Token": token,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(audioBuffer.byteLength)
    },
    body: new Uint8Array(audioBuffer)
  });

  const data = await readResponseJson<{ status?: number; message?: string; result?: string }>(
    response
  );

  const transcript = data.result?.trim() ?? "";
  if (response.ok && (data.message === "SUCCESS" || data.status === 20000000)) {
    return transcript;
  }

  throw new Error(data.message || `阿里云语音识别失败（${data.status ?? response.status}）`);
}

async function transcribeWithOpenAi(audioBuffer: Buffer): Promise<string> {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], {
      type: "audio/wav"
    }),
    "recording.wav"
  );
  formData.append("model", OPENAI_TRANSCRIPTION_MODEL);
  formData.append("language", "zh");
  formData.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: formData
  });

  const data = await readResponseJson<{ text?: string; error?: { message?: string } }>(response);

  if (response.ok && data.text?.trim()) {
    return data.text.trim();
  }

  throw new Error(data.error?.message || `OpenAI 语音识别失败（${response.status}）`);
}

async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  if (voiceCapabilities.provider === "aliyun-nls") {
    return transcribeWithAliyunNls(audioBuffer);
  }

  if (voiceCapabilities.provider === "openai") {
    return transcribeWithOpenAi(audioBuffer);
  }

  throw new Error("服务器未配置语音识别服务");
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "elderly-companion-backend",
    time: new Date().toISOString()
  });
});

app.get("/api/voice/capabilities", (_req: Request, res: Response) => {
  res.json(voiceCapabilities);
});

app.post(
  "/api/voice/transcribe",
  express.raw({
    type: ["audio/wav", "audio/x-wav", "application/octet-stream"],
    limit: "10mb"
  }),
  async (req: Request, res: Response) => {
    if (!voiceCapabilities.enabled) {
      res.status(503).json({ error: voiceCapabilities.note });
      return;
    }

    const audioBuffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!audioBuffer || audioBuffer.byteLength < 512) {
      res.status(400).json({ error: "录音内容太短，请再说一遍。" });
      return;
    }

    try {
      const text = await transcribeAudio(audioBuffer);
      if (!text.trim()) {
        res.status(422).json({ error: "没有识别到有效内容，请再说一遍。" });
        return;
      }

      res.json({ text, provider: voiceCapabilities.provider });
    } catch (error) {
      console.error("voice transcription failed", error);
      const message = error instanceof Error ? error.message : "语音识别失败";
      res.status(502).json({ error: message });
    }
  }
);

app.post("/api/chat", async (req: Request, res: Response) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  addChat("user", message);
  const heuristicRisk = detectRisk(message);
  let reply = buildReply(message, heuristicRisk);
  let risk = heuristicRisk;

  if (DEEPSEEK_API_KEY) {
    try {
      const decision = await callDeepSeekCareAgent({
        apiKey: DEEPSEEK_API_KEY,
        model: DEEPSEEK_MODEL,
        baseUrl: DEEPSEEK_BASE_URL,
        context: buildAgentContext(message, heuristicRisk),
        toolResultsExecutor: (toolCalls) => {
          return executeAgentToolCalls(toolCalls, message).toolResults;
        }
      });
      const createdEmergency = decision.toolCalls.some((item) => item.name === "create_emergency");
      risk = heuristicRisk || decision.risk || createdEmergency;

      if (risk && !createdEmergency) {
        createEmergency("keyword", message);
      }

      reply = decision.assistantReply;
    } catch (error) {
      console.error("deepseek chat failed", error);
      if (risk) {
        createEmergency("keyword", message);
      }
    }
  } else if (risk) {
    createEmergency("keyword", message);
  }

  addChat("assistant", reply, risk);
  res.json({ reply, risk });
});

app.get("/api/logs", (_req: Request, res: Response) => {
  const items = [...messages].slice(-80).reverse();
  res.json({ items });
});

app.get("/api/reminders", (_req: Request, res: Response) => {
  res.json({ items: reminders });
});

app.post("/api/reminders", (req: Request, res: Response) => {
  const title = String(req.body?.title ?? "").trim();
  const time = String(req.body?.time ?? "").trim();

  if (!title || !time) {
    res.status(400).json({ error: "title and time are required" });
    return;
  }

  const reminder: Reminder = {
    id: reminderId++,
    title,
    time,
    status: "pending"
  };

  reminders.unshift(reminder);
  res.status(201).json({ item: reminder });
});

app.patch("/api/reminders/:id/ack", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const action = String(req.body?.action ?? "") as ReminderStatus;
  const reminder = reminders.find((item) => item.id === id);

  if (!reminder) {
    res.status(404).json({ error: "reminder not found" });
    return;
  }

  if (!["pending", "done", "snooze", "skip"].includes(action)) {
    res.status(400).json({ error: "invalid action" });
    return;
  }

  if (action === "snooze") {
    reminder.status = "pending";
    reminder.time = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  } else {
    reminder.status = action;
  }

  res.json({ item: reminder });
});

app.get("/api/emergencies", (_req: Request, res: Response) => {
  res.json({ items: emergencies });
});

app.get("/api/emergencies/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const event = emergencies.find((item) => item.id === id);
  if (!event) {
    res.status(404).json({ error: "event not found" });
    return;
  }
  res.json({ item: event });
});

app.post("/api/emergencies/manual", (req: Request, res: Response) => {
  const triggerText = String(req.body?.triggerText ?? "").trim();
  const event = createEmergency("manual", triggerText || "用户手动触发");
  res.status(201).json({ item: event });
});

app.patch("/api/emergencies/:id/resolve", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const actionText = String(req.body?.actionText ?? "标记为已处理");
  const event = emergencies.find((item) => item.id === id);
  if (!event) {
    res.status(404).json({ error: "event not found" });
    return;
  }
  event.status = "resolved";
  event.actionLog.push(actionText);
  res.json({ item: event });
});

app.get("/api/family/summary", (_req: Request, res: Response) => {
  const openEmergencies = emergencies.filter((item) => item.status === "open").length;
  const pendingReminders = reminders.filter((item) => item.status === "pending").length;
  res.json({
    totalMessages: messages.length,
    openEmergencies,
    pendingReminders
  });
});

app.get("/api/family/timeline", (_req: Request, res: Response) => {
  const items = buildFamilyTimeline().slice(0, 100);
  res.json({ items });
});

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));

  app.get("*", (req: Request, res: Response, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.sendFile(path.join(frontendDistDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`backend started on :${PORT}`);
  console.log(`voice transcription provider: ${voiceCapabilities.provider}`);
  if (voiceCapabilities.provider === "aliyun-nls" && hasAliyunAutoToken) {
    console.log("aliyun nls token mode: auto-refresh via AccessKey");
  }
  if (DEEPSEEK_API_KEY) {
    console.log(`deepseek agent enabled: ${DEEPSEEK_MODEL}`);
  }
});
