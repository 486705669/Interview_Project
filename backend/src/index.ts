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

function buildReply(text: string, risk: boolean): string {
  if (risk) {
    return "\u6211\u542c\u5230\u60a8\u53ef\u80fd\u6709\u7d27\u6025\u4e0d\u9002\u3002\u8bf7\u4f18\u5148\u62e8\u6253120\uff0c\u6216\u7acb\u5373\u8054\u7cfb\u7d27\u6025\u8054\u7cfb\u4eba\u3002";
  }

  if (
    text.includes("\u63d0\u9192") ||
    text.includes("\u5403\u836f") ||
    text.includes("\u559d\u6c34")
  ) {
    return "\u597d\u7684\uff0c\u6211\u53ef\u4ee5\u5e2e\u60a8\u8bb0\u5f55\u63d0\u9192\u3002\u4e5f\u53ef\u4ee5\u5728\u63d0\u9192\u9875\u9762\u624b\u52a8\u65b0\u589e\u3002";
  }

  if (
    text.includes("\u5b64\u5355") ||
    text.includes("\u65e0\u804a") ||
    text.includes("\u96be\u8fc7")
  ) {
    return "\u6211\u5728\u8fd9\u91cc\u966a\u60a8\u3002\u60a8\u53ef\u4ee5\u7ee7\u7eed\u8bf4\uff0c\u6211\u4f1a\u8010\u5fc3\u542c\u3002";
  }

  return "\u6211\u542c\u5230\u4e86\u3002\u60a8\u53ef\u4ee5\u7ee7\u7eed\u8bf4\uff0c\u6211\u4f1a\u4e00\u6b65\u6b65\u966a\u60a8\u5904\u7406\u3002";
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
