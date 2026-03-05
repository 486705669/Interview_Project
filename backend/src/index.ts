import cors from "cors";
import express, { type Request, type Response } from "express";

type Role = "user" | "assistant";
type ReminderStatus = "pending" | "done" | "snooze" | "skip";

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
  source: "keyword" | "manual";
  triggerText: string;
  createdAt: string;
  status: "open" | "resolved";
  actionLog: string[];
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);

const messages: ChatMessage[] = [];
const reminders: Reminder[] = [];
const emergencies: EmergencyEvent[] = [];

let messageId = 1;
let reminderId = 1;
let emergencyId = 1;

const riskKeywords = [
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
  /胸.*痛/,
  /胸口.*痛/,
  /呼吸.*困难/,
  /喘不上气/,
  /晕倒/,
  /昏迷/,
  /头.*剧烈.*痛/,
  /肚子.*痛.*厉害/,
  /心慌/,
  /chest\s*pain/i,
  /shortness\s*of\s*breath/i
];

function detectRisk(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return (
    riskKeywords.some((word) => normalized.toLowerCase().includes(word)) ||
    riskPatterns.some((pattern) => pattern.test(normalized))
  );
}

function buildReply(text: string, risk: boolean): string {
  if (risk) {
    return "我听到您可能有紧急不适。请优先拨打120，或立即联系紧急联系人。我会继续陪着您。";
  }

  if (text.includes("提醒") || text.includes("吃药") || text.includes("喝水")) {
    return "好的，我可以帮您记录提醒。您也可以去“提醒”页直接新增。";
  }

  if (text.includes("孤单") || text.includes("无聊") || text.includes("难过")) {
    return "我在这儿陪您。要不要聊聊今天发生的事，或者一起听听您喜欢的话题？";
  }

  return "我听到了。您可以继续说，我会一步一步陪您处理。";
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

function createEmergency(
  source: "keyword" | "manual",
  triggerText: string
): EmergencyEvent {
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

app.listen(PORT, () => {
  console.log(`backend started on :${PORT}`);
});
