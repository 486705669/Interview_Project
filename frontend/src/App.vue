<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

type Tab = "chat" | "reminder" | "logs" | "family" | "eventDetail";
type ReminderStatus = "pending" | "done" | "snooze" | "skip";
type VoiceProvider = "aliyun-nls" | "openai" | "disabled";

type AudioContextConstructor = new () => AudioContext;

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
  type: "chat" | "reminder" | "emergency" | "record";
  title: string;
  description: string;
  createdAt: string;
  level: "normal" | "warning";
}

interface VoiceCapabilities {
  enabled: boolean;
  provider: VoiceProvider;
  note: string;
}

interface RecorderNodes {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
}

const apiBase = import.meta.env.VITE_API_BASE ?? "/api";
const activeTab = ref<Tab>("chat");
const loading = ref(false);
const recording = ref(false);
const uploadingAudio = ref(false);
const emergencyMode = ref(false);
const chatInput = ref("");
const voiceStatus = ref("");
const reminders = ref<Reminder[]>([]);
const messages = ref<ChatMessage[]>([]);
const emergencies = ref<EmergencyEvent[]>([]);
const activeDueReminder = ref<Reminder | null>(null);
const familySummary = ref<FamilySummary>({
  totalMessages: 0,
  openEmergencies: 0,
  pendingReminders: 0
});
const familyTimeline = ref<TimelineItem[]>([]);
const selectedEvent = ref<EmergencyEvent | null>(null);
const voiceCapabilities = ref<VoiceCapabilities>({
  enabled: false,
  provider: "disabled",
  note: "服务器还没有配置服务端语音识别，请先用打字。"
});
const newReminderTitle = ref("");
const newReminderTime = ref("");

let reminderTimer: number | null = null;
let recorderNodes: RecorderNodes | null = null;
let pcmChunks: Float32Array[] = [];
let inputSampleRate = 44100;
let recordingStartedAt = 0;
const notifiedReminderKeys = new Set<string>();

const isSecureOrigin = computed(() => {
  return (
    window.isSecureContext ||
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
  );
});

const hasRecorderSupport = computed(() => {
  return Boolean(navigator.mediaDevices?.getUserMedia && getAudioContextConstructor());
});

const voiceButtonDisabled = computed(() => {
  return (
    !isSecureOrigin.value ||
    !hasRecorderSupport.value ||
    !voiceCapabilities.value.enabled ||
    loading.value ||
    uploadingAudio.value
  );
});

const voiceButtonLabel = computed(() => {
  if (uploadingAudio.value) {
    return "识别中...";
  }

  return recording.value ? "松开发送" : "按住说话";
});

const voiceTip = computed(() => {
  if (voiceStatus.value) {
    return voiceStatus.value;
  }

  if (!isSecureOrigin.value) {
    return "当前不是 HTTPS 页面，浏览器不会开放麦克风。";
  }

  if (!hasRecorderSupport.value) {
    return "当前浏览器不支持录音，请改用系统浏览器。";
  }

  if (!voiceCapabilities.value.enabled) {
    return voiceCapabilities.value.note;
  }

  return voiceCapabilities.value.note;
});

const voiceProviderLabel = computed(() => {
  if (voiceCapabilities.value.provider === "aliyun-nls") {
    return "阿里云服务端语音识别";
  }

  if (voiceCapabilities.value.provider === "openai") {
    return "OpenAI 服务端语音识别";
  }

  return "未配置";
});

function getAudioContextConstructor(): AudioContextConstructor | null {
  const withKit = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };

  return window.AudioContext || withKit.webkitAudioContext || null;
}

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

async function ensurePermissionNotDenied(): Promise<boolean> {
  if (!navigator.permissions?.query) {
    return true;
  }

  try {
    const result = await navigator.permissions.query({
      name: "microphone" as PermissionName
    });

    if (result.state === "denied") {
      voiceStatus.value = "麦克风权限已被拒绝，请在浏览器站点设置中改为允许。";
      return false;
    }
  } catch {
    // Ignore browsers that do not support microphone permission query.
  }

  return true;
}

function buildReminderKey(reminder: Reminder): string {
  return `${reminder.id}:${reminder.time}`;
}

function checkDueReminders(): void {
  const now = Date.now();
  const dueReminder = reminders.value.find((item) => {
    if (item.status !== "pending") {
      return false;
    }

    const dueAt = new Date(item.time).getTime();
    if (Number.isNaN(dueAt)) {
      return false;
    }

    return dueAt <= now;
  });

  if (!dueReminder) {
    return;
  }

  const reminderKey = buildReminderKey(dueReminder);
  if (notifiedReminderKeys.has(reminderKey)) {
    return;
  }

  notifiedReminderKeys.add(reminderKey);
  activeDueReminder.value = dueReminder;
  speak(`提醒您：${dueReminder.title}`);

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("老人陪伴助手提醒", {
      body: dueReminder.title
    });
  }
}

function registerGlobalReleaseListeners(): void {
  window.addEventListener("pointerup", handleGlobalPointerUp);
  window.addEventListener("pointercancel", handleGlobalPointerCancel);
  window.addEventListener("blur", handleGlobalPointerCancel);
}

function unregisterGlobalReleaseListeners(): void {
  window.removeEventListener("pointerup", handleGlobalPointerUp);
  window.removeEventListener("pointercancel", handleGlobalPointerCancel);
  window.removeEventListener("blur", handleGlobalPointerCancel);
}

function handleGlobalPointerUp(): void {
  if (recording.value) {
    void stopPressRecording(false);
  }
}

function handleGlobalPointerCancel(): void {
  if (recording.value) {
    void stopPressRecording(true);
  }
}

async function cleanupRecorder(): Promise<void> {
  unregisterGlobalReleaseListeners();

  if (!recorderNodes) {
    return;
  }

  recorderNodes.processor.onaudioprocess = null;
  recorderNodes.source.disconnect();
  recorderNodes.processor.disconnect();
  recorderNodes.sink.disconnect();
  recorderNodes.stream.getTracks().forEach((track) => track.stop());

  if (recorderNodes.context.state !== "closed") {
    await recorderNodes.context.close().catch(() => undefined);
  }

  recorderNodes = null;
}

function mergeAudioChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function floatTo16Bit(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function downsampleTo16k(buffer: Float32Array, sourceSampleRate: number): Int16Array {
  if (sourceSampleRate === 16000) {
    return Int16Array.from(buffer, (sample) => floatTo16Bit(sample));
  }

  const ratio = sourceSampleRate / 16000;
  const resultLength = Math.round(buffer.length / ratio);
  const result = new Int16Array(resultLength);

  let offsetBuffer = 0;
  for (let index = 0; index < resultLength; index += 1) {
    const nextOffsetBuffer = Math.round((index + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let sourceIndex = offsetBuffer; sourceIndex < nextOffsetBuffer && sourceIndex < buffer.length; sourceIndex += 1) {
      sum += buffer[sourceIndex] ?? 0;
      count += 1;
    }

    const sample = count > 0 ? sum / count : 0;
    result[index] = floatTo16Bit(sample);
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function writeAsciiString(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWav(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAsciiString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, samples[index] ?? 0, true);
  }

  return buffer;
}

function buildWavBlob(chunks: Float32Array[], sourceSampleRate: number): Blob {
  const merged = mergeAudioChunks(chunks);
  const downsampled = downsampleTo16k(merged, sourceSampleRate);
  const wavBuffer = encodeWav(downsampled, 16000);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

async function fetchVoiceCapabilities(): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/voice/capabilities`);
    if (!response.ok) {
      throw new Error("voice capabilities failed");
    }

    voiceCapabilities.value = (await response.json()) as VoiceCapabilities;
  } catch {
    voiceCapabilities.value = {
      enabled: false,
      provider: "disabled",
      note: "暂时读不到服务器语音配置，请先用打字。"
    };
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
  checkDueReminders();
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
  } catch {
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

async function uploadRecording(audioBlob: Blob): Promise<void> {
  uploadingAudio.value = true;
  voiceStatus.value = "正在上传录音并识别...";

  try {
    const response = await fetch(`${apiBase}/voice/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav"
      },
      body: audioBlob
    });

    const data = (await response.json()) as { text?: string; error?: string };
    if (!response.ok || !data.text?.trim()) {
      throw new Error(data.error || "服务器暂时无法识别语音");
    }

    chatInput.value = data.text.trim();
    voiceStatus.value = `已识别：${chatInput.value}`;
    await sendMessage();
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传录音失败";
    voiceStatus.value = `语音识别失败：${message}`;
  } finally {
    uploadingAudio.value = false;
  }
}

async function startPressRecording(): Promise<void> {
  if (recording.value || voiceButtonDisabled.value) {
    return;
  }

  if (!isSecureOrigin.value) {
    voiceStatus.value = "当前不是 HTTPS 页面，浏览器不会开放麦克风。";
    return;
  }

  if (!hasRecorderSupport.value) {
    voiceStatus.value = "当前浏览器不支持录音，请改用系统浏览器。";
    return;
  }

  if (!voiceCapabilities.value.enabled) {
    voiceStatus.value = voiceCapabilities.value.note;
    return;
  }

  const permissionOk = await ensurePermissionNotDenied();
  if (!permissionOk) {
    return;
  }

  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) {
    voiceStatus.value = "当前浏览器不支持录音。";
    return;
  }

  try {
    window.speechSynthesis?.cancel();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const context = new AudioContextCtor();
    if (context.state === "suspended") {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const sink = context.createGain();
    sink.gain.value = 0;

    pcmChunks = [];
    inputSampleRate = context.sampleRate;
    recordingStartedAt = Date.now();

    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!recording.value) {
        return;
      }

      const inputData = event.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(inputData));
    };

    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);

    recorderNodes = {
      stream,
      context,
      source,
      processor,
      sink
    };

    registerGlobalReleaseListeners();
    recording.value = true;
    voiceStatus.value = "正在录音，松开发送。";
  } catch {
    await cleanupRecorder();
    voiceStatus.value = "打开麦克风失败，请检查系统和浏览器权限。";
  }
}

async function stopPressRecording(cancelUpload: boolean): Promise<void> {
  if (!recording.value) {
    return;
  }

  recording.value = false;
  const duration = Date.now() - recordingStartedAt;
  const recordedChunks = pcmChunks;
  const sourceSampleRate = inputSampleRate;
  pcmChunks = [];

  await cleanupRecorder();

  if (cancelUpload) {
    voiceStatus.value = "录音已取消。";
    return;
  }

  if (duration < 400 || recordedChunks.length === 0) {
    voiceStatus.value = "录音时间太短，请再按住说一句。";
    return;
  }

  const audioBlob = buildWavBlob(recordedChunks, sourceSampleRate);
  await uploadRecording(audioBlob);
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

  if (activeDueReminder.value?.id === id) {
    activeDueReminder.value = null;
  }

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
  speak("已进入紧急模式，请优先拨打 120 或联系家属。");
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
  await Promise.all([refreshAll(), fetchVoiceCapabilities()]);

  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission().catch(() => undefined);
  }

  reminderTimer = window.setInterval(() => {
    checkDueReminders();
  }, 10000);
});

onUnmounted(() => {
  if (reminderTimer !== null) {
    window.clearInterval(reminderTimer);
  }

  unregisterGlobalReleaseListeners();
  void cleanupRecorder();
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

    <section v-if="activeDueReminder" class="emergency-banner">
      <strong>提醒到了：{{ activeDueReminder.title }}</strong>
      <p>{{ formatTime(activeDueReminder.time) }}</p>
      <div class="due-actions">
        <button type="button" @click="ackReminder(activeDueReminder.id, 'done')">已完成</button>
        <button type="button" @click="ackReminder(activeDueReminder.id, 'snooze')">
          10 分钟后再提醒
        </button>
      </div>
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
        :class="{ recording }"
        type="button"
        :disabled="voiceButtonDisabled"
        @pointerdown.prevent="startPressRecording"
        @contextmenu.prevent
      >
        {{ voiceButtonLabel }}
      </button>

      <p class="tips">{{ voiceTip }}</p>
      <p class="voice-provider">当前识别：{{ voiceProviderLabel }}</p>
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
            <p>{{ formatTime(item.time) }} / {{ item.status }}</p>
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
            <p>{{ formatTime(item.createdAt) }} / {{ item.status }} / {{ item.source }}</p>
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
            <p>{{ formatTime(item.createdAt) }} / {{ item.type }}</p>
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
        <p><strong>事件 ID：</strong>{{ selectedEvent.id }}</p>
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

