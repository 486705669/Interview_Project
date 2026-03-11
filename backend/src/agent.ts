export type AgentToolCallName =
  | "create_reminder"
  | "create_emergency"
  | "record_note"
  | "get_current_time";

export interface AgentToolCall {
  id: string;
  name: AgentToolCallName;
  arguments: Record<string, unknown>;
}

export interface AgentToolResult {
  toolCallId: string;
  name: AgentToolCallName;
  content: string;
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
  timeZone: string;
  nowLocalText: string;
  localDateText: string;
  localTimeText: string;
  weekdayText: string;
  userMessage: string;
  recentMessages: AgentContextMessage[];
  reminders: AgentContextReminder[];
  emergencies: AgentContextEmergency[];
  notes: AgentContextNote[];
  heuristicRisk: boolean;
}

interface DeepSeekToolDefinition {
  type: "function";
  function: {
    name: AgentToolCallName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface DeepSeekChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface DeepSeekChatCompletionResponse {
  choices?: Array<{
    message?: DeepSeekChatMessage;
  }>;
  error?: {
    message?: string;
  };
}

const DSML_FUNCTION_CALLS_PATTERN =
  /<[^>]*DSML[^>]*function_calls>[\s\S]*?<\/[^>]*DSML[^>]*function_calls>/giu;
const DSML_INVOKE_PATTERN =
  /<[^>]*DSML[^>]*invoke name="([^"]+)">([\s\S]*?)<\/[^>]*DSML[^>]*invoke>/giu;
const DSML_PARAMETER_PATTERN =
  /<[^>]*DSML[^>]*parameter name="([^"]+)"(?: [^>]*)?>([\s\S]*?)<\/[^>]*DSML[^>]*parameter>/giu;

const CARE_AGENT_SYSTEM_PROMPT = `
你是“老人陪伴助手”，服务对象是 60 岁以上老人。

你的身份与职责：
1. 用温和、简短、好懂的中文和老人交流。
2. 在陪伴聊天的同时，主动帮助老人处理提醒、身体不适记录和风险上报。
3. 你不是医生，不做医疗诊断，不给处方。
4. 如果发现高风险情况，要优先进入求助路径，并调用 create_emergency 工具。
5. 如果只是轻度不适、情绪波动、睡眠、食欲、活动状态变化，优先记录并给出生活化建议。

高风险例子：
- 胸痛、胸闷明显加重
- 呼吸困难、喘不上气
- 晕倒、昏迷
- 突发剧烈头痛
- 症状快速恶化且老人独居

工具使用规则：
- get_current_time：当用户问“现在几点”“今天几号”“星期几”“今天周几”这类当前时间问题时，优先调用这个工具，不要凭记忆猜测。
- create_reminder：当用户明确提出提醒需求，或你能根据上下文合理判断需要提醒吃药、喝水、复诊、休息时调用。
- create_emergency：当出现高风险表达，或需要留下紧急事件记录时调用。
- record_note：当用户提到身体不舒服、睡眠、情绪、食欲、活动状态等值得追踪的信息时调用。
- 可以同时调用多个工具。
- 工具调用之后，再向老人说明你已经帮他做了什么。

回复要求：
- 先安抚，再给一个清晰下一步。
- 句子短，不要长篇大论。
- 不要说“作为一个AI”。
- 不要输出 Markdown。
- 不要把任何工具调用标签、DSML 标签、XML 标签直接展示给用户。
- 所有时间、日期、星期相关回答，都必须以上下文里的 nowLocalText、localDateText、localTimeText、weekdayText 或工具返回结果为准。
`;

const DEEPSEEK_TOOLS: DeepSeekToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description:
        "Get the current local time, current date, weekday, and timezone from the server for accurate answers.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_reminder",
      description: "Create a reminder for medication, drinking water, rest, follow-up, or other timed care tasks.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short reminder title shown to the elderly user."
          },
          time: {
            type: "string",
            description: "Reminder time in ISO-8601 format, preferably with timezone offset."
          }
        },
        required: ["title", "time"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_emergency",
      description: "Create an emergency event when the user's words indicate urgent risk or immediate escalation is needed.",
      parameters: {
        type: "object",
        properties: {
          triggerText: {
            type: "string",
            description: "The symptom or sentence that caused the emergency escalation."
          },
          actionText: {
            type: "string",
            description: "Short explanation for the record about why this emergency was created."
          }
        },
        required: ["triggerText", "actionText"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "record_note",
      description: "Record a care note about symptoms, habits, mood, appetite, sleep, or safety-related observations.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Short Chinese summary of what should be tracked."
          },
          category: {
            type: "string",
            enum: ["symptom", "habit", "mood", "safety"],
            description: "Note category."
          },
          level: {
            type: "string",
            enum: ["normal", "warning"],
            description: "How serious or noteworthy the note is."
          }
        },
        required: ["summary", "category", "level"],
        additionalProperties: false
      }
    }
  }
];

function normalizeToolCallName(name: string): AgentToolCallName | null {
  if (
    name === "create_reminder" ||
    name === "create_emergency" ||
    name === "record_note" ||
    name === "get_current_time"
  ) {
    return name;
  }

  return null;
}

function isCurrentTimeQuestion(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return /现在几点|几点了|当前时间|今天几号|今天几月几号|今天星期几|今天周几|星期几|周几|几号/u.test(
    normalized
  );
}

function buildCurrentTimeReply(context: AgentContext): string {
  return `现在是${context.nowLocalText}，时区是${context.timeZone}。`;
}

function sanitizeAssistantContent(content: string | null | undefined): string {
  if (!content) {
    return "";
  }

  return content
    .replace(DSML_FUNCTION_CALLS_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeRecordNoteCategory(rawValue: unknown): "symptom" | "habit" | "mood" | "safety" {
  const text = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (!text) {
    return "symptom";
  }

  if (/(habit|习惯|吃药|服药|用药|作息|喝水)/u.test(text)) {
    return "habit";
  }

  if (/(mood|情绪|心情|焦虑|难过|孤独|烦)/u.test(text)) {
    return "mood";
  }

  if (/(safety|安全|跌倒|摔倒|走失|危险)/u.test(text)) {
    return "safety";
  }

  return "symptom";
}

function normalizeRecordNoteLevel(rawValue: unknown, summary: string): "normal" | "warning" {
  const text = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (/(warning|高风险|异常|加重|危险|紧急)/u.test(text)) {
    return "warning";
  }

  if (/(胸痛|呼吸困难|晕倒|昏迷|剧烈头痛)/u.test(summary)) {
    return "warning";
  }

  return "normal";
}

function parseDsmlToolCalls(content: string | null | undefined): AgentToolCall[] {
  if (!content || !content.includes("DSML")) {
    return [];
  }

  const toolCalls: AgentToolCall[] = [];
  for (const invokeMatch of content.matchAll(DSML_INVOKE_PATTERN)) {
    const rawName = invokeMatch[1]?.trim() || "";
    const normalizedName = normalizeToolCallName(rawName);
    if (!normalizedName) {
      continue;
    }

    const rawArgs: Record<string, string> = {};
    const body = invokeMatch[2] ?? "";
    for (const paramMatch of body.matchAll(DSML_PARAMETER_PATTERN)) {
      const key = paramMatch[1]?.trim();
      if (!key) {
        continue;
      }

      rawArgs[key] = (paramMatch[2] ?? "").trim();
    }

    let argumentsObject: Record<string, unknown> = rawArgs;
    if (normalizedName === "record_note") {
      const summary =
        rawArgs.summary?.trim() ||
        rawArgs.content?.trim() ||
        rawArgs.note?.trim() ||
        rawArgs.text?.trim() ||
        "";
      argumentsObject = {
        summary,
        category: normalizeRecordNoteCategory(rawArgs.category),
        level: normalizeRecordNoteLevel(rawArgs.level, summary)
      };
    } else if (normalizedName === "create_reminder") {
      argumentsObject = {
        title:
          rawArgs.title?.trim() ||
          rawArgs.task?.trim() ||
          rawArgs.content?.trim() ||
          rawArgs.reminder?.trim() ||
          "提醒事项",
        time:
          rawArgs.time?.trim() ||
          rawArgs.at?.trim() ||
          rawArgs.datetime?.trim() ||
          rawArgs.remind_at?.trim() ||
          ""
      };
    } else if (normalizedName === "create_emergency") {
      argumentsObject = {
        triggerText:
          rawArgs.triggerText?.trim() ||
          rawArgs.trigger?.trim() ||
          rawArgs.content?.trim() ||
          rawArgs.summary?.trim() ||
          "",
        actionText:
          rawArgs.actionText?.trim() ||
          rawArgs.reason?.trim() ||
          "模型判定需要重点关注"
      };
    }

    toolCalls.push({
      id: `dsml_${toolCalls.length + 1}`,
      name: normalizedName,
      arguments: argumentsObject
    });
  }

  return toolCalls;
}

function parseToolCalls(message: DeepSeekChatMessage | undefined): AgentToolCall[] {
  if (!message) {
    return [];
  }

  const structuredToolCalls =
    message.tool_calls
      ?.map((item): AgentToolCall | null => {
        const normalizedName = normalizeToolCallName(item.function.name);
        if (!normalizedName) {
          return null;
        }

        try {
          const parsedArguments = JSON.parse(item.function.arguments || "{}");
          return {
            id: item.id,
            name: normalizedName,
            arguments:
              parsedArguments && typeof parsedArguments === "object"
                ? (parsedArguments as Record<string, unknown>)
                : {}
          };
        } catch {
          return {
            id: item.id,
            name: normalizedName,
            arguments: {}
          };
        }
      })
      .filter((item): item is AgentToolCall => item !== null) ?? [];

  if (structuredToolCalls.length > 0) {
    return structuredToolCalls;
  }

  return parseDsmlToolCalls(message.content);
}

async function requestDeepSeek(options: {
  apiKey: string;
  model: string;
  baseUrl: string;
  messages: DeepSeekChatMessage[];
  tools?: DeepSeekToolDefinition[];
}): Promise<DeepSeekChatMessage> {
  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.2,
      messages: options.messages,
      tools: options.tools
    })
  });

  const payload = (await response.json()) as DeepSeekChatCompletionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `DeepSeek API failed (${response.status})`);
  }

  const message = payload.choices?.[0]?.message;
  if (!message) {
    throw new Error("DeepSeek returned empty message");
  }

  return message;
}

export async function callDeepSeekCareAgent(options: {
  apiKey: string;
  model: string;
  baseUrl: string;
  context: AgentContext;
  toolResultsExecutor: (toolCalls: AgentToolCall[]) => Promise<AgentToolResult[]> | AgentToolResult[];
}): Promise<AgentDecision> {
  const { apiKey, model, baseUrl, context, toolResultsExecutor } = options;
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

  const firstMessage = await requestDeepSeek({
    apiKey,
    model,
    baseUrl,
    messages,
    tools: DEEPSEEK_TOOLS
  });
  const toolCalls = parseToolCalls(firstMessage);

  if (toolCalls.length === 0) {
    const cleanedFirstReply = sanitizeAssistantContent(firstMessage.content);
    return {
      assistantReply:
        (isCurrentTimeQuestion(context.userMessage) ? buildCurrentTimeReply(context) : "") ||
        cleanedFirstReply ||
        "我在这儿。您再跟我说具体一点，我来一步步帮您处理。",
      risk: context.heuristicRisk,
      toolCalls: []
    };
  }

  messages.push({
    role: "assistant",
    content: firstMessage.content ?? "",
    tool_calls: firstMessage.tool_calls
  });

  const toolResults = await toolResultsExecutor(toolCalls);
  for (const result of toolResults) {
    messages.push({
      role: "tool",
      tool_call_id: result.toolCallId,
      content: result.content
    });
  }

  const finalMessage = await requestDeepSeek({
    apiKey,
    model,
    baseUrl,
    messages
  });
  const cleanedFinalReply = sanitizeAssistantContent(finalMessage.content);
  const cleanedFirstReply = sanitizeAssistantContent(firstMessage.content);

  return {
    assistantReply:
      cleanedFinalReply ||
      cleanedFirstReply ||
      "我已经先帮您记下来了，您再跟我说具体一点，我继续帮您处理。",
    risk:
      context.heuristicRisk || toolCalls.some((item) => item.name === "create_emergency"),
    toolCalls
  };
}
