<script def>
{
  "navigationBarTitleText": "透明模式"
}
</script>

<script setup>
import wx from 'wx';
import { getConfig, getSession } from '../../lib/store.js';
import { findAlertSession, isFatalSetupError } from '../../lib/gateway.js';

export default {
  data: {
    sessionId: '',
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
      this.routeSpoken(spoken);
    };
    recognition.onerror = () => {
      this.commandRecognition = null;
    };
    recognition.onend = () => {
      this.commandRecognition = null;
    };
    this.commandRecognition = recognition;
    try {
      recognition.start();
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
  routeSpoken(spoken) {
    const text = (spoken || '').replace(/\s+/g, '');
    if (!text) return;
    if (/透明模式/.test(text)) return;
    if (/^(?:切换|切|换).*(?:会话|回话|绘画|会)|会话列表/.test(text)) {
      wx.redirectTo({ url: '/pages/sessions/index' });
      return;
    }
    if (/tui|终端|命令行|TUI/i.test(text)) {
      wx.redirectTo({ url: '/pages/tui/index' });
      return;
    }
    if (/助手|乐奇|切换模式|切换界面|正常模式/.test(text)) {
      wx.redirectTo({ url: '/pages/assistant/index' });
    }
  },
};
</script>

<page>
  <view class="page">
    <view class="dot"></view>
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
</style>
