<script def>
{
  "navigationBarTitleText": "Fuluk 助手"
}
</script>

<script setup>
import wx from 'wx';
import { getConfig, getSession, loadChatHistory, saveChatHistory } from '../../lib/store.js';
import { askAssistant, answerText, findAlertSession, isFatalSetupError } from '../../lib/gateway.js';
import { polishTranscript } from '../../lib/polish.js';

export default {
  data: {
    sessionId: '',
    sessionName: '',
    messages: [],
    state: 'idle',
    hint: '说"乐奇"或点击镜腿开始说话',
    scrollTop: 0,
  },
  commandRecognition: null,
  pollTimer: null,
  messageSeq: 0,
  onLoad() {
    if (!getConfig()) {
      wx.redirectTo({ url: '/pages/setup/index' });
      return;
    }
    const session = getSession();
    if (!session) {
      wx.redirectTo({ url: '/pages/sessions/index' });
      return;
    }
    this.setData({ sessionId: session.id, sessionName: session.name });
    const history = loadChatHistory(session.id);
    this.messageSeq = history.seq;
    if (history.messages.length) {
      this.setData({
        messages: history.messages,
        scrollTop: 100000 + history.messages.length,
      });
    }
    this.enableWorldAwareness();
    this.startPolling();
  },
  onShow() {
    this.confirmOpen = false;
    this.startPolling();
    this.enableWorldAwareness();
  },
  onHide() {
    this.stopPolling();
  },
  onUnload() {
    this.stopPolling();
    this.stopCommandListening();
  },
  startPolling() {
    this.stopPolling();
    if (!this.data.sessionId) return;
    this.pollTimer = setInterval(() => this.checkPrompt(), 4000);
  },
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },
  checkPrompt() {
    if (this.confirmOpen) return;
    findAlertSession(this.completedSeen || [])
      .then((alert) => {
        if (!Array.isArray(this.completedSeen)) {
          this.completedSeen = alert.completedIds.slice();
        } else {
          this.completedSeen = this.completedSeen.filter((id) => alert.completedIds.includes(id));
        }
        if (!alert.type) return;
        const session = alert.session;
        if (alert.type === 'done') this.completedSeen.push(session.id);
        this.confirmOpen = true;
        this.stopPolling();
        const page = alert.type === 'confirm' ? 'confirm' : 'done';
        wx.navigateTo({
          url: `/pages/${page}/index?id=${encodeURIComponent(session.id)}&name=${encodeURIComponent(session.name || session.id)}`,
        });
      })
      .catch((error) => {
        if (isFatalSetupError(error)) this.backToSetup();
      });
  },
  backToSetup() {
    this.stopPolling();
    this.stopCommandListening();
    wx.redirectTo({ url: '/pages/setup/index?edit=1' });
  },
  openSetup() {
    wx.navigateTo({ url: '/pages/setup/index?edit=1' });
  },
  // ---- Wake word（系统级唤醒：onVoiceWakeup）----
  onVoiceWakeup() {
    if (this.data.state === 'idle') this.startCommandListening();
  },
  // ---- Command ----
  startCommandListening() {
    if (this.commandRecognition || this.data.state === 'busy') return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.resultIndex];
      const raw = result && result[0] ? result[0].transcript : '';
      this.commandRecognition = null;
      this.handleCommand(raw);
    };
    recognition.onerror = (event) => {
      this.commandRecognition = null;
      this.setData({ state: 'idle', hint: `没听清（${event.error || '识别失败'}）` });
    };
    recognition.onend = () => {
      this.commandRecognition = null;
      if (this.data.state === 'listening') {
        this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿开始说话' });
      }
    };
    this.commandRecognition = recognition;
    recognition.start();
    this.setData({ state: 'listening', hint: '正在聆听…' });
  },
  stopCommandListening() {
    if (this.commandRecognition) {
      try {
        this.commandRecognition.abort();
      } catch {}
      this.commandRecognition = null;
    }
  },
  async handleCommand(raw) {
    const transcript = (raw || '').trim();
    if (!transcript) {
      this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿开始说话' });
      return;
    }
    if (/^(?:切换|切|换).*(?:会话|回话|绘画|会)|会话列表/.test(transcript)) {
      this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿开始说话' });
      wx.redirectTo({ url: '/pages/sessions/index' });
      return;
    }
    if (/透明模式/.test(transcript)) {
      this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿开始说话' });
      wx.redirectTo({ url: '/pages/transparent/index' });
      return;
    }
    if (/切换(?:模式|磨式|界面)/.test(transcript)) {
      this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿开始说话' });
      if (/透明/.test(transcript)) {
        wx.redirectTo({ url: '/pages/transparent/index' });
      } else if (/tui|终端|命令行/i.test(transcript)) {
        wx.redirectTo({ url: '/pages/tui/index' });
      } else {
        wx.redirectTo({ url: '/pages/tui/index' });
      }
      return;
    }
    this.setData({ state: 'busy', hint: '正在处理…' });
    let text;
    try {
      text = await polishTranscript(transcript);
    } catch {
      text = transcript;
    }
    this.sendCommand(text || transcript);
  },
  appendMessages(items) {
    const seq = this.messageSeq || 0;
    const withIds = items.map((item, index) => ({ ...item, mid: `m${seq + index}` }));
    this.messageSeq = seq + items.length;
    const updated = this.data.messages.concat(withIds);
    this.setData({
      messages: updated,
      scrollTop: 100000 + this.messageSeq,
    });
    saveChatHistory(this.data.sessionId, updated, this.messageSeq);
  },
  sendCommand(text) {
    this.appendMessages([{ role: 'user', text }]);
    this.setData({ hint: '正在发送…' });
    askAssistant(text, this.data.sessionId)
      .then((body) => {
        const reply = answerText(body);
        this.appendMessages([{ role: 'assistant', text: reply }]);
        this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿开始说话' });
        if (reply) {
          const utterance = new SpeechSynthesisUtterance(reply);
          utterance.lang = 'zh-CN';
          speechSynthesis.speak(utterance, 'immediate');
        }
      })
      .catch((error) => {
        if (isFatalSetupError(error)) {
          this.backToSetup();
          return;
        }
        this.appendMessages([{ role: 'assistant', text: `错误：${error.message}` }]);
        this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿开始说话' });
      });
  },
  onKeyDown(event) {
    if (event.code === 'GlobalHook' && this.data.state === 'idle') {
      this.startCommandListening();
    }
  },
};
</script>

<page>
  <view class="page">
    <view class="header">
      <text class="session">{{sessionName}}</text>
      <button class="link" bindtap="openSetup">设置</button>
    </view>
    <scroll-view class="messages" scroll-y="true" scroll-top="{{scrollTop}}">
      <view ink:for="{{messages}}" ink:key="mid" class="msg msg-{{item.role}}">
        <text class="msg-role">{{item.role === 'user' ? '我说：' : '助手：'}}</text>
        <view class="msg-text">{{item.text}}</view>
      </view>
    </scroll-view>
    <view class="status-bar status-{{state}}">
      <text class="status-text">{{hint}}</text>
    </view>
  </view>
</page>

<style>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}
.header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.session {
  color: #40ff5e;
  font-size: 16px;
  font-weight: 500;
}
.link {
  border: 1px solid rgba(64, 255, 94, 0.48);
  border-radius: 4px;
  padding: 4px 8px;
  color: rgba(64, 255, 94, 0.72);
  font-size: 11px;
}
.messages {
  flex-grow: 1;
  flex-basis: 0;
}
.msg {
  padding: 5px 2px;
}
.msg-role {
  color: rgba(64, 255, 94, 0.48);
  font-size: 12px;
}
.msg-user .msg-text {
  color: #40ff5e;
  font-size: 13px;
}
.msg-assistant .msg-text {
  color: rgba(64, 255, 94, 0.72);
  font-size: 13px;
}
.msg-text {
  color: rgba(64, 255, 94, 0.72);
  font-size: 13px;
}
.status-bar {
  padding-top: 8px;
  height: 22px;
}
.status-text {
  color: rgba(64, 255, 94, 0.48);
  font-size: 12px;
}
.status-listening .status-text,
.status-busy .status-text {
  color: #40ff5e;
}
</style>
