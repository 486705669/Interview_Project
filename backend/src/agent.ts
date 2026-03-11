export type AgentToolCallName = "create_reminder" | "create_emergency" | "record_note";

export interface AgentToolCall {
  name: AgentToolCallName;
  arguments: Record<string, unknown>;
  reason?: string;
}

export interface AgentDecision {
  assistantReply: string;
  risk: boolean;
  toolCalls: AgentToolCall[];
}

export interface AgentContextMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface AgentContextReminder {
  title: string;
  time: string;
  status: string;
}

export interface AgentContextEmergency {
  triggerText: string;
  status: string;
  createdAt: string;
}

export interface AgentContextNote {
  summary: string;
  level: string;
  category: string;
  createdAt: string;
}

export interface AgentContext {
  nowIso: string;
  userMessage: string;
  recentMessages: AgentContextMessage[];
  reminders: AgentContextReminder[];
  emergencies: AgentContextEmergency[];
  notes: AgentContextNote[];
  heuristicRisk: boolean;
}

interface DeepSeekChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

const CARE_AGENT_SYSTEM_PROMPT = `
你是“老人陪伴助手”，服务对象是 60 岁以上老人。

你的身份与职责：
1. 用温和、简短、好懂的中文和老人交流。
2. 在陪伴聊天的同时，主动帮助老人处理提醒、身体不适记录和风险上报。
3. 你不是医生，不做医疗诊断，不给处方。
4. 如果发现高风险情况，要优先进入求助路径，并调用 create_emergency 工具。

高风险例子：
- 胸痛、胸闷明显加重
- 呼吸困难、喘不上气
- 晕倒、昏迷
- 突发剧烈头痛
- 症状快速恶化且老人独居

工具使用规则：
- create_reminder：当用户明确提出提醒需求，或你能根据上下文合理判断需要提醒吃药、喝水、复诊、休息时调用。必须尽量给出 ISO 时间字符串。
- create_emergency：当出现高风险表达，或需要留下紧急事件记录时调用。
- record_note：当用户提到身体不舒服、睡眠、情绪、食欲、活动状态等值得追踪的信息时调用。
- 可以同时调用多个工具。
- 如果不需要工具，就返回空数组。

回复要求：
- 先安抚，再给一个清晰下一步。
- 句子短，不要长篇大论。
- 不要说“作为一个AI”。
- 不要输出 Markdown。

你必须只返回 JSON，对应以下结构：
{
  "assistant_reply": "给老人的最终回复",
  "risk": true,
  "tool_calls": [
    {
      "name": "create_reminder",
      "reason": "为什么要调这个工具",
      "arguments": {
        "title": "提醒内容",
        "time": "2026-03-11T20:00:00+08:00"
      }
    }
  ]
}
`;

function normalizeDecision(raw: unknown): AgentDecision {
  const data = (raw ?? {}) as {
    assistant_reply?: unknown;
    risk?: unknown;
    tool_calls?: unknown;
  };

  const toolCalls = Array.isArray(data.tool_calls)
    ? data.tool_calls
        .filter((item): item is { name?: unknown; arguments?: unknown; reason?: unknown } => {
          return Boolean(item && typeof item === "object");
        })
        .map((item): AgentToolCall | null => {
          if (
            item.name !== "create_reminder" &&
            item.name !== "create_emergency" &&
            item.name !== "record_note"
          ) {
            return null;
          }

          return {
            name: item.name,
            arguments:
              item.arguments && typeof item.arguments === "object"
                ? (item.arguments as Record<string, unknown>)
                : {},
            reason: typeof item.reason === "string" ? item.reason : undefined
          };
        })
        .filter((item): item is AgentToolCall => item !== null)
    : [];

  return {
    assistantReply:
      typeof data.assistant_reply === "string" && data.assistant_reply.trim()
        ? data.assistant_reply.trim()
        : "我在这儿。您再跟我说具体一点，我来一步步帮您处理。",
    risk: Boolean(data.risk),
    toolCalls
  };
}

export async function callDeepSeekCareAgent(options: {
  apiKey: string;
  model: string;
  baseUrl: string;
  context: AgentContext;
}): Promise<AgentDecision> {
  const { apiKey, model, baseUrl, context } = options;
  const messages: DeepSeekChatMessage[] = [
    {
      role: "system",
      content: CARE_AGENT_SYSTEM_PROMPT.trim()
    },
    {
      role: "user",
      content: JSON.stringify(context, null, 2)
    }
  ];

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages
    })
  });

  const payload = (await response.json()) as DeepSeekChatCompletionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `DeepSeek API failed (${response.status})`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("DeepSeek returned empty content");
  }

  return normalizeDecision(JSON.parse(content));
}
