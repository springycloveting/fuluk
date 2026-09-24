<script def>
{
  "navigationBarTitleText": "透明模式"
}
</script>

<script setup>
import wx from 'wx';
import { getConfig, getSession } from '../../lib/store.js';
import { findAlertSession, isFatalSetupError, askAssistant, answerText } from '../../lib/gateway.js';
import { polishTranscript } from '../../lib/polish.js';

export default {
  data: {
    sessionId: '',
    state: 'idle',
    hint: '',
  },
  commandRecognition: null,
  pollTimer: null,
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
    this.setData({ sessionId: session.id });
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
  // 前台挂载：低频检查会话是否需要确认
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
  // ---- 唤醒：仅用于切换离开，不发送指令 ----
  onVoiceWakeup() {
    this.startCommandListening();
  },
  startCommandListening() {
    if (this.commandRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.resultIndex];
      const spoken = result && result[0] ? result[0].transcript.trim() : '';
      this.commandRecognition = null;
      this.handleCommand(spoken);
    };
    recognition.onerror = (event) => {
      this.commandRecognition = null;
      this.showHint(`没听清（${event.error || '识别失败'}）`);
    };
    recognition.onend = () => {
      this.commandRecognition = null;
      if (this.data.state === 'listening') {
        this.setData({ state: 'idle', hint: '' });
      }
    };
    this.commandRecognition = recognition;
    try {
      recognition.start();
      this.setData({ state: 'listening', hint: '正在聆听…' });
    } catch {
      this.commandRecognition = null;
    }
  },
  stopCommandListening() {
    if (this.commandRecognition) {
      try {
        this.commandRecognition.abort();
      } catch {}
      this.commandRecognition = null;
    }
  },
  // 导航命令直接跳转，未匹配走 sendCommand
  async handleCommand(spoken) {
    const text = (spoken || '').replace(/\s+/g, '');
    if (!text) {
      this.setData({ state: 'idle', hint: '' });
      return;
    }
    if (/透明模式/.test(text)) {
      this.setData({ state: 'idle', hint: '' });
      return;
    }
    if (/^(?:切换|切|换).*(?:会话|回话|绘画|会)|会话列表/.test(text)) {
      this.setData({ state: 'idle', hint: '' });
      wx.redirectTo({ url: '/pages/sessions/index' });
      return;
    }
    if (/tui|终端|命令行|TUI/i.test(text)) {
      this.setData({ state: 'idle', hint: '' });
      wx.redirectTo({ url: '/pages/tui/index' });
      return;
    }
    if (/助手|乐奇|切换模式|切换界面|正常模式/.test(text)) {
      this.setData({ state: 'idle', hint: '' });
      wx.redirectTo({ url: '/pages/assistant/index' });
      return;
    }
    // 未匹配导航命令 → 发送到网关助手
    this.setData({ state: 'sending', hint: '正在发送…' });
    let polished;
    try {
      polished = await polishTranscript(spoken);
    } catch {
      polished = spoken;
    }
    this.sendCommand(polished || spoken);
  },
  sendCommand(text) {
    askAssistant(text, this.data.sessionId)
      .then((body) => {
        const reply = answerText(body);
        this.setData({ state: 'idle', hint: '' });
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
        this.showHint(`发送失败：${error.message || '网络错误'}`);
      });
  },
  // 临时提示：2.5 秒后恢复 idle
  showHint(message) {
    this.setData({ state: 'error', hint: message });
    setTimeout(() => {
      if (this.data.state === 'error') {
        this.setData({ state: 'idle', hint: '' });
      }
    }, 2500);
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
    <view class="dot"></view>
    <view ink:if="{{state !== 'idle'}}" class="hint-wrap">
      <text class="hint-text">{{hint}}</text>
    </view>
  </view>
</page>

<style>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.dot {
  width: 2px;
  height: 2px;
  border-radius: 1px;
  background-color: rgba(64, 255, 94, 0.24);
}
.hint-wrap {
  margin-top: 6px;
}
.hint-text {
  color: rgba(64, 255, 94, 0.72);
  font-size: 12px;
}
</style>
