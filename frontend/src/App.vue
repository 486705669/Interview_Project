<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type Tab = "chat" | "reminder" | "logs" | "family" | "eventDetail";
type ReminderStatus = "pending" | "done" | "snooze" | "skip";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
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
  source: string;
  triggerText: string;
  createdAt: string;
  status: "open" | "resolved";
  actionLog: string[];
}

interface FamilySummary {
  totalMessages: number;
  openEmergencies: number;
  pendingReminders: number;
}

interface TimelineItem {
  id: string;
  type: "chat" | "reminder" | "emergency";
  title: string;
  description: string;
  createdAt: string;
  level: "normal" | "warning";
}

const apiBase = import.meta.env.VITE_API_BASE ?? "/api";
const activeTab = ref<Tab>("chat");
const listening = ref(false);
const loading = ref(false);
const emergencyMode = ref(false);
const chatInput = ref("");
const reminders = ref<Reminder[]>([]);
const messages = ref<ChatMessage[]>([]);
const emergencies = ref<EmergencyEvent[]>([]);
const familySummary = ref<FamilySummary>({
  totalMessages: 0,
  openEmergencies: 0,
  pendingReminders: 0
});
const familyTimeline = ref<TimelineItem[]>([]);
const selectedEvent = ref<EmergencyEvent | null>(null);
const newReminderTitle = ref("");
const newReminderTime = ref("");

let recognition: SpeechRecognition | null = null;

const canUseSpeechRecognition = computed(() => {
  const withKit = window as unknown as { webkitSpeechRecognition?: unknown };
  return Boolean(window.SpeechRecognition || withKit.webkitSpeechRecognition);
});

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function speak(text: string): void {
  if (!("speechSynthesis" in window)) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function createRecognition(): SpeechRecognition | null {
  if (recognition) {
    return recognition;
  }
  const withKit = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  const SpeechRecognitionCtor =
    window.SpeechRecognition || withKit.webkitSpeechRecognition;

  if (!SpeechRecognitionCtor) {
    return null;
  }

  const rec = new SpeechRecognitionCtor();
  rec.lang = "zh-CN";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (event: SpeechRecognitionEvent) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? "";
    if (!transcript) {
      return;
    }
    chatInput.value = transcript;
    void sendMessage();
  };
  rec.onerror = () => {
    listening.value = false;
  };
  rec.onend = () => {
    listening.value = false;
  };
  recognition = rec;
  return recognition;
}

function toggleListening(): void {
  const rec = createRecognition();
  if (!rec) {
    return;
  }
  if (listening.value) {
    rec.stop();
    listening.value = false;
    return;
  }
  listening.value = true;
  rec.start();
}

async function fetchLogs(): Promise<void> {
  const response = await fetch(`${apiBase}/logs`);
  if (!response.ok) {
    return;
  }
  const data = (await response.json()) as { items: ChatMessage[] };
  messages.value = data.items;
}

async function fetchReminders(): Promise<void> {
  const response = await fetch(`${apiBase}/reminders`);
  if (!response.ok) {
    return;
  }
  const data = (await response.json()) as { items: Reminder[] };
  reminders.value = data.items;
}

async function fetchEmergencies(): Promise<void> {
  const response = await fetch(`${apiBase}/emergencies`);
  if (!response.ok) {
    return;
  }
  const data = (await response.json()) as { items: EmergencyEvent[] };
  emergencies.value = data.items;
}

async function fetchFamilyData(): Promise<void> {
  const [summaryResponse, timelineResponse] = await Promise.all([
    fetch(`${apiBase}/family/summary`),
    fetch(`${apiBase}/family/timeline`)
  ]);

  if (summaryResponse.ok) {
    familySummary.value = (await summaryResponse.json()) as FamilySummary;
  }

  if (timelineResponse.ok) {
    const data = (await timelineResponse.json()) as { items: TimelineItem[] };
    familyTimeline.value = data.items;
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([
    fetchLogs(),
    fetchReminders(),
    fetchEmergencies(),
    fetchFamilyData()
  ]);
}

async function sendMessage(): Promise<void> {
  const text = chatInput.value.trim();
  if (!text || loading.value) {
    return;
  }

  const optimisticId = Date.now();
  messages.value.push({
    id: optimisticId,
    role: "user",
    text,
    createdAt: new Date().toISOString()
  });
  chatInput.value = "";
  loading.value = true;

  try {
    const response = await fetch(`${apiBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    if (!response.ok) {
      throw new Error("chat request failed");
    }

    const data = (await response.json()) as { reply: string; risk: boolean };
    messages.value.push({
      id: optimisticId + 1,
      role: "assistant",
      text: data.reply,
      createdAt: new Date().toISOString(),
      risk: data.risk
    });

    if (data.risk) {
      emergencyMode.value = true;
      activeTab.value = "chat";
    }

    speak(data.reply);
    await refreshAll();
  } catch (_error) {
    messages.value.push({
      id: optimisticId + 2,
      role: "assistant",
      text: "我暂时连不上服务，请稍后再试。",
      createdAt: new Date().toISOString()
    });
  } finally {
    loading.value = false;
  }
}

async function createReminder(): Promise<void> {
  const title = newReminderTitle.value.trim();
  const time = newReminderTime.value.trim();
  if (!title || !time) {
    return;
  }
  await fetch(`${apiBase}/reminders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, time })
  });
  newReminderTitle.value = "";
  newReminderTime.value = "";
  await refreshAll();
}

async function ackReminder(id: number, action: ReminderStatus): Promise<void> {
  await fetch(`${apiBase}/reminders/${id}/ack`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
  await refreshAll();
}

async function triggerManualEmergency(): Promise<void> {
  await fetch(`${apiBase}/emergencies/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ triggerText: "用户手动点击紧急求助" })
  });
  emergencyMode.value = true;
  activeTab.value = "chat";
  speak("已进入紧急模式，请优先拨打120或联系家属。");
  await refreshAll();
}

async function openEmergencyDetail(id: number): Promise<void> {
  const response = await fetch(`${apiBase}/emergencies/${id}`);
  if (!response.ok) {
    return;
  }
  const data = (await response.json()) as { item: EmergencyEvent };
  selectedEvent.value = data.item;
  activeTab.value = "eventDetail";
}

async function resolveSelectedEmergency(): Promise<void> {
  if (!selectedEvent.value) {
    return;
  }
  await fetch(`${apiBase}/emergencies/${selectedEvent.value.id}/resolve`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionText: "家属/后台确认已处理" })
  });
  await openEmergencyDetail(selectedEvent.value.id);
  await refreshAll();
}

onMounted(async () => {
  await refreshAll();
});
</script>

<template>
  <main class="app">
    <header class="header">
      <div>
        <p class="caption">老人陪伴助手</p>
        <h1>开口就能用</h1>
      </div>
      <button class="danger" type="button" @click="triggerManualEmergency">
        紧急求助
      </button>
    </header>

    <section v-if="emergencyMode" class="emergency-banner">
      <strong>紧急模式中</strong>
      <p>优先执行：拨打 120 或联系紧急联系人。</p>
    </section>

    <nav class="tabs">
      <button
        type="button"
        :class="{ active: activeTab === 'chat' }"
        @click="activeTab = 'chat'"
      >
        陪聊
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'reminder' }"
        @click="activeTab = 'reminder'"
      >
        提醒
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'logs' }"
        @click="activeTab = 'logs'"
      >
        记录
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'family' }"
        @click="activeTab = 'family'"
      >
        家属/后台
      </button>
    </nav>

    <section v-if="activeTab === 'chat'" class="panel chat-panel">
      <ul class="chat-list">
        <li
          v-for="item in messages.slice().reverse()"
          :key="item.id"
          :class="['bubble', item.role, { risk: item.risk }]"
        >
          <p>{{ item.text }}</p>
          <time>{{ formatTime(item.createdAt) }}</time>
        </li>
      </ul>
      <form class="composer" @submit.prevent="sendMessage">
        <input
          v-model="chatInput"
          type="text"
          maxlength="120"
          placeholder="您可以说：我今天有点头晕"
        />
        <button type="submit" :disabled="loading">
          {{ loading ? "处理中..." : "发送" }}
        </button>
      </form>
      <button
        class="voice"
        type="button"
        :disabled="!canUseSpeechRecognition"
        @click="toggleListening"
      >
        {{ listening ? "停止说话" : "按下开始语音" }}
      </button>
      <p v-if="!canUseSpeechRecognition" class="tips">
        当前浏览器不支持语音识别，可使用文字输入。
      </p>
    </section>

    <section v-if="activeTab === 'reminder'" class="panel">
      <h2>提醒管理</h2>
      <form class="reminder-form" @submit.prevent="createReminder">
        <input v-model="newReminderTitle" type="text" placeholder="提醒内容（如：吃药）" />
        <input v-model="newReminderTime" type="datetime-local" />
        <button type="submit">新增提醒</button>
      </form>
      <ul class="list">
        <li v-for="item in reminders" :key="item.id" class="list-item">
          <div>
            <strong>{{ item.title }}</strong>
            <p>{{ formatTime(item.time) }} · {{ item.status }}</p>
          </div>
          <div class="actions">
            <button type="button" @click="ackReminder(item.id, 'done')">已完成</button>
            <button type="button" @click="ackReminder(item.id, 'snooze')">稍后</button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="activeTab === 'logs'" class="panel">
      <div class="topbar">
        <h2>应急记录</h2>
      </div>
      <ul class="list">
        <li v-for="item in emergencies" :key="item.id" class="list-item">
          <div>
            <strong>{{ item.triggerText }}</strong>
            <p>{{ formatTime(item.createdAt) }} · {{ item.status }} · {{ item.source }}</p>
          </div>
          <div class="actions">
            <button type="button" @click="openEmergencyDetail(item.id)">查看详情</button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="activeTab === 'family'" class="panel family-panel">
      <div class="topbar">
        <h2>家属/后台查询</h2>
        <button type="button" @click="fetchFamilyData">刷新</button>
      </div>

      <div class="summary-grid">
        <article class="metric">
          <p>总对话数</p>
          <strong>{{ familySummary.totalMessages }}</strong>
        </article>
        <article class="metric warning">
          <p>未关闭应急</p>
          <strong>{{ familySummary.openEmergencies }}</strong>
        </article>
        <article class="metric warning">
          <p>待执行提醒</p>
          <strong>{{ familySummary.pendingReminders }}</strong>
        </article>
      </div>

      <h3>关键时间线</h3>
      <ul class="list">
        <li
          v-for="item in familyTimeline"
          :key="item.id"
          class="list-item"
          :class="{ warning: item.level === 'warning' }"
        >
          <div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.description }}</p>
            <p>{{ formatTime(item.createdAt) }} · {{ item.type }}</p>
          </div>
          <div v-if="item.type === 'emergency'" class="actions">
            <button type="button" @click="openEmergencyDetail(Number(item.id.split('-')[1]))">
              查看详情
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="activeTab === 'eventDetail'" class="panel">
      <div class="topbar">
        <h2>应急事件详情</h2>
        <button type="button" @click="activeTab = 'family'">返回</button>
      </div>

      <div v-if="selectedEvent" class="detail-card">
        <p><strong>事件ID：</strong>{{ selectedEvent.id }}</p>
        <p><strong>触发来源：</strong>{{ selectedEvent.source }}</p>
        <p><strong>触发语句：</strong>{{ selectedEvent.triggerText }}</p>
        <p><strong>创建时间：</strong>{{ formatTime(selectedEvent.createdAt) }}</p>
        <p><strong>当前状态：</strong>{{ selectedEvent.status }}</p>
        <h3>处置动作日志</h3>
        <ul class="list">
          <li v-for="(action, index) in selectedEvent.actionLog" :key="index" class="list-item">
            {{ action }}
          </li>
        </ul>
        <button
          type="button"
          class="primary"
          :disabled="selectedEvent.status === 'resolved'"
          @click="resolveSelectedEmergency"
        >
          {{ selectedEvent.status === "resolved" ? "已处理" : "标记为已处理" }}
        </button>
      </div>
    </section>
  </main>
</template>

