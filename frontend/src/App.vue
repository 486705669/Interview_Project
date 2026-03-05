<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type Tab = "chat" | "reminder" | "logs";
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
  status: string;
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

    const data = (await response.json()) as {
      reply: string;
      risk: boolean;
    };

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
    await Promise.all([fetchReminders(), fetchEmergencies(), fetchLogs()]);
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
  await fetchReminders();
}

async function ackReminder(id: number, action: ReminderStatus): Promise<void> {
  await fetch(`${apiBase}/reminders/${id}/ack`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
  await fetchReminders();
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
  await fetchEmergencies();
}

onMounted(async () => {
  await Promise.all([fetchLogs(), fetchReminders(), fetchEmergencies()]);
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
      <h2>应急记录</h2>
      <ul class="list">
        <li v-for="item in emergencies" :key="item.id" class="list-item">
          <div>
            <strong>{{ item.triggerText }}</strong>
            <p>{{ formatTime(item.createdAt) }} · {{ item.status }} · {{ item.source }}</p>
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>

