import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type Request, type Response } from "express";

type Role = "user" | "assistant";
type ReminderStatus = "pending" | "done" | "snooze" | "skip";
type EmergencySource = "keyword" | "manual";
type EmergencyStatus = "open" | "resolved";

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

interface FamilyTimelineItem {
  id: string;
  type: "chat" | "reminder" | "emergency";
  title: string;
  description: string;
  createdAt: string;
  level: "normal" | "warning";
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDistDir =
  process.env.FRONTEND_DIST_DIR ?? path.resolve(currentDir, "../../frontend/dist");
const hasFrontendBuild = fs.existsSync(frontendDistDir);
const messages: ChatMessage[] = [];
const reminders: Reminder[] = [];
const emergencies: EmergencyEvent[] = [];

let messageId = 1;
let reminderId = 1;
let emergencyId = 1;

const riskKeywordFragments = [
  "\u80f8\u75db",
  "\u80f8\u53e3\u75db",
  "\u547c\u5438\u56f0\u96be",
  "\u5598\u4e0d\u4e0a\u6c14",
  "\u6655\u5012",
  "\u660f\u8ff7",
  "\u5267\u70c8\u5934\u75db",
  "\u809a\u5b50\u75db\u5f97\u5389\u5bb3",
  "\u5fc3\u614c",
  "chest pain",
  "shortness of breath",
  "fainted"
];

const riskPatterns: RegExp[] = [
  /\u80f8.*\u75db/u,
  /\u80f8\u53e3.*\u75db/u,
  /\u547c\u5438.*\u56f0\u96be/u,
  /\u5598\u4e0d\u4e0a\u6c14/u,
  /\u6655\u5012/u,
  /\u660f\u8ff7/u,
  /\u5934.*\u5267\u70c8.*\u75db/u,
  /\u809a\u5b50.*\u75db.*\u5389\u5bb3/u,
  /\u5fc3\u614c/u,
  /chest\s*pain/i,
  /shortness\s*of\s*breath/i
];

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
  return /[？?]$/.test(text) || /吗|什么|怎么|如何|为什么|几点|多少/.test(text);
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
    return "\u6211\u542c\u5230\u60a8\u53ef\u80fd\u6709\u7d27\u6025\u4e0d\u9002\u3002\u8bf7\u4f18\u5148\u62e8\u6253120\uff0c\u6216\u7acb\u5373\u8054\u7cfb\u7d27\u6025\u8054\u7cfb\u4eba\u3002\u5982\u679c\u60a8\u8fd8\u80fd\u8bf4\u8bdd\uff0c\u53ef\u4ee5\u544a\u8bc9\u6211\u73b0\u5728\u6700\u96be\u53d7\u7684\u611f\u89c9\u662f\u4ec0\u4e48\u3002";
  }

  if (includesAny(normalized, ["你好", "您好", "在吗", "早上好", "晚上好"])) {
    return "\u60a8\u597d\uff0c\u6211\u5728\u8fd9\u91cc\u3002\u60a8\u60f3\u804a\u804a\u5929\uff0c\u8bbe\u4e2a\u63d0\u9192\uff0c\u8fd8\u662f\u8bf4\u8bf4\u73b0\u5728\u8eab\u4f53\u6709\u54ea\u91cc\u4e0d\u8212\u670d\uff1f";
  }

  if (includesAny(normalized, ["你是谁", "你叫什么", "你是干嘛的"])) {
    return "\u6211\u662f\u8001\u4eba\u966a\u4f34\u52a9\u624b\u3002\u6211\u73b0\u5728\u4e3b\u8981\u80fd\u966a\u60a8\u804a\u5929\uff0c\u5e2e\u60a8\u8bb0\u63d0\u9192\uff0c\u8bb0\u5f55\u5173\u952e\u60c5\u51b5\uff0c\u9047\u5230\u98ce\u9669\u65f6\u4f18\u5148\u5f15\u5bfc\u6c42\u52a9\u3002";
  }

  if (
    includesAny(normalized, [
      "你会做什么",
      "你能做什么",
      "能帮我什么",
      "怎么用",
      "帮助",
      "功能"
    ])
  ) {
    return "\u6211\u73b0\u5728\u6700\u64c5\u957f\u56db\u4ef6\u4e8b\uff1a\u966a\u60a8\u804a\u5929\uff0c\u5e2e\u60a8\u8bbe\u63d0\u9192\uff0c\u8bb0\u5f55\u91cd\u8981\u60c5\u51b5\uff0c\u9047\u5230\u5371\u9669\u65f6\u5f15\u5bfc\u60a8\u6c42\u52a9\u3002\u60a8\u60f3\u5148\u804a\u804a\uff0c\u8fd8\u662f\u8bbe\u4e2a\u63d0\u9192\uff1f";
  }

  if (includesAny(normalized, ["提醒", "吃药", "喝水", "复诊", "闹钟", "记得"])) {
    return "\u53ef\u4ee5\u3002\u6211\u80fd\u5e2e\u60a8\u8bb0\u5403\u836f\uff0c\u559d\u6c34\uff0c\u590d\u8bca\u8fd9\u4e9b\u63d0\u9192\u3002\u60a8\u53ef\u4ee5\u76f4\u63a5\u544a\u8bc9\u6211\u65f6\u95f4\u548c\u4e8b\u60c5\uff0c\u4e5f\u53ef\u4ee5\u53bb\u63d0\u9192\u9875\u624b\u52a8\u65b0\u589e\u3002";
  }

  if (includesAny(normalized, ["孤单", "孤独", "无聊", "难过", "烦", "陪我聊", "想聊天"])) {
    return "\u542c\u8d77\u6765\u60a8\u73b0\u5728\u9700\u8981\u6709\u4eba\u966a\u60a8\u8bf4\u8bdd\u3002\u6211\u5728\u8fd9\u91cc\u3002\u60a8\u6700\u60f3\u804a\u7684\u662f\u5bb6\u91cc\u4eba\uff0c\u8eab\u4f53\u60c5\u51b5\uff0c\u8fd8\u662f\u4eca\u5929\u53d1\u751f\u7684\u4e8b\uff1f";
  }

  if (includesAny(normalized, ["谢谢", "麻烦你", "辛苦了"])) {
    return "\u4e0d\u5ba2\u6c14\u3002\u6211\u4f1a\u7ee7\u7eed\u966a\u7740\u60a8\u3002\u60a8\u8fd8\u60f3\u804a\u804a\uff0c\u8fd8\u662f\u9700\u8981\u6211\u5e2e\u60a8\u8bbe\u4e2a\u63d0\u9192\uff1f";
  }

  if (includesAny(normalized, ["睡不着", "失眠", "睡不好"])) {
    return "\u665a\u4e0a\u7761\u4e0d\u7740\u4f1a\u5f88\u96be\u53d7\u3002\u6211\u4e0d\u505a\u533b\u7597\u8bca\u65ad\uff0c\u4f46\u60a8\u53ef\u4ee5\u5148\u8bd5\u8bd5\u653e\u6162\u547c\u5438\uff0c\u55dd\u70b9\u6e29\u6c34\uff0c\u5c11\u770b\u523a\u6fc0\u5185\u5bb9\u3002\u5982\u679c\u60a8\u613f\u610f\uff0c\u6211\u53ef\u4ee5\u5148\u966a\u60a8\u804a\u4e00\u4f1a\u513f\u3002";
  }

  if (includesAny(normalized, ["头疼", "头痛", "肚子疼", "胃不舒服", "咳嗽", "发烧", "鼻塞", "乏力", "腿疼", "腰酸"])) {
    return "\u542c\u8d77\u6765\u60a8\u8eab\u4f53\u6709\u4e9b\u4e0d\u8212\u670d\u3002\u6211\u4e0d\u80fd\u76f4\u63a5\u505a\u533b\u7597\u8bca\u65ad\uff0c\u4f46\u5efa\u8bae\u60a8\u5148\u4f11\u606f\uff0c\u559d\u70b9\u6e29\u6c34\uff0c\u7559\u610f\u75c7\u72b6\u6709\u6ca1\u6709\u52a0\u91cd\u3002\u5982\u679c\u540c\u65f6\u51fa\u73b0\u80f8\u75db\uff0c\u547c\u5438\u56f0\u96be\uff0c\u660f\u5012\u6216\u75c7\u72b6\u660e\u663e\u52a0\u91cd\uff0c\u8bf7\u7acb\u5373\u6c42\u52a9\u3002";
  }

  if (includesAny(normalized, ["家人", "儿子", "女儿", "孙子", "孙女", "老伴", "家里人"])) {
    return "\u60a8\u63d0\u5230\u5bb6\u91cc\u4eba\u4e86\u3002\u662f\u60f3\u804a\u804a\u4ed6\u4eec\uff0c\u8fd8\u662f\u60f3\u8bb0\u4e00\u4ef6\u7a0d\u540e\u8981\u544a\u8bc9\u5bb6\u5c5e\u7684\u4e8b\u60c5\uff1f";
  }

  if (includesAny(normalized, ["天气", "下雨", "温度", "新闻", "今天发生什么"])) {
    return "\u6211\u8fd9\u4e2a\u7248\u672c\u6682\u65f6\u4e0d\u76f4\u63a5\u67e5\u5b9e\u65f6\u5929\u6c14\u548c\u65b0\u95fb\u3002\u5982\u679c\u60a8\u662f\u62c5\u5fc3\u51fa\u95e8\uff0c\u7a7f\u8863\uff0c\u5e26\u4f1e\u8fd9\u7c7b\u95ee\u9898\uff0c\u6211\u53ef\u4ee5\u5148\u966a\u60a8\u62c6\u89e3\u8981\u505a\u4ec0\u4e48\u51c6\u5907\u3002";
  }

  if (isQuestion(text)) {
    return `\u6211\u660e\u767d\u60a8\u5728\u95ee\u201c${extractTopic(text)}\u201d\u3002\u5c31\u8fd9\u4e2a\u7248\u672c\u6765\u8bf4\uff0c\u6211\u66f4\u64c5\u957f\u966a\u804a\uff0c\u63d0\u9192\u548c\u5b89\u5168\u6c42\u52a9\u3002\u60a8\u662f\u60f3\u8981\u6211\u76f4\u63a5\u5e2e\u60a8\u505a\u4e0b\u4e00\u6b65\uff0c\u8fd8\u662f\u5148\u548c\u6211\u8bf4\u8bf4\u60a8\u62c5\u5fc3\u7684\u70b9\uff1f`;
  }

  return `\u6211\u542c\u5230\u60a8\u5728\u8bf4\u201c${extractTopic(text)}\u201d\u3002\u8fd9\u4ef6\u4e8b\u66f4\u50cf\u662f\u8ba9\u60a8\u62c5\u5fc3\uff0c\u8eab\u4f53\u4e0d\u8212\u670d\uff0c\u8fd8\u662f\u53ea\u662f\u60f3\u627e\u4eba\u804a\u804a\uff1f`;
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
    actionLog: ["\u521b\u5efa\u4e8b\u4ef6"]
  };
  emergencies.unshift(event);
  return event;
}

function buildFamilyTimeline(): FamilyTimelineItem[] {
  const chatItems: FamilyTimelineItem[] = messages.slice(-40).map((item) => ({
    id: `chat-${item.id}`,
    type: "chat",
    title: item.role === "user" ? "\u7528\u6237\u5bf9\u8bdd" : "\u52a9\u624b\u56de\u590d",
    description: item.text,
    createdAt: item.createdAt,
    level: item.risk ? "warning" : "normal"
  }));

  const reminderItems: FamilyTimelineItem[] = reminders.map((item) => ({
    id: `reminder-${item.id}`,
    type: "reminder",
    title: "\u63d0\u9192\u4e8b\u9879",
    description: `${item.title} · ${item.status}`,
    createdAt: item.time,
    level: item.status === "pending" ? "warning" : "normal"
  }));

  const emergencyItems: FamilyTimelineItem[] = emergencies.map((item) => ({
    id: `emergency-${item.id}`,
    type: "emergency",
    title: "\u7d27\u6025\u4e8b\u4ef6",
    description: item.triggerText,
    createdAt: item.createdAt,
    level: "warning"
  }));

  return [...chatItems, ...reminderItems, ...emergencyItems].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "elderly-companion-backend",
    time: new Date().toISOString()
  });
});

app.post("/api/chat", (req: Request, res: Response) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  addChat("user", message);
  const risk = detectRisk(message);
  const reply = buildReply(message, risk);

  if (risk) {
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

  reminder.status = action;
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
  const event = createEmergency("manual", triggerText || "\u7528\u6237\u624b\u52a8\u89e6\u53d1");
  res.status(201).json({ item: event });
});

app.patch("/api/emergencies/:id/resolve", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const actionText = String(req.body?.actionText ?? "\u6807\u8bb0\u4e3a\u5df2\u5904\u7406");
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
});
