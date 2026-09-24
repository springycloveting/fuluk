<script def>
{
  "navigationBarTitleText": "会话 TUI"
}
</script>

<script setup>
import wx from 'wx';
import { getConfig, getSession } from '../../lib/store.js';
import {
  fetchSessionOutput,
  sendSessionInput,
  findConfirmingSession,
  isFatalSetupError,
} from '../../lib/gateway.js';

export default {
  data: {
    sessionId: '',
    sessionName: '',
    lines: [],
    draft: '',
    state: 'idle',
    hint: '说"乐奇"或点击镜腿说话',
    outputScrollTop: 0,
  },
  commandRecognition: null,
  outputTimer: null,
  promptTimer: null,
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
    this.enableWorldAwareness();
    this.refreshOutput();
    this.outputTimer = setInterval(() => this.refreshOutput(), 2000);
    this.promptTimer = setInterval(() => this.checkPrompt(), 4000);
  },
  onUnload() {
    if (this.outputTimer) clearInterval(this.outputTimer);
    if (this.promptTimer) clearInterval(this.promptTimer);
    this.stopCommandListening();
  },
  async refreshOutput() {
    try {
      const text = await fetchSessionOutput(this.data.sessionId, 120);
      const cleaned = stripAnsi(typeof text === 'string' ? text : '');
      const rawLines = cleaned.split('\n');
      const lines = rawLines.map((line, index) => ({ id: index, text: line }));
      this.setData({
        lines,
        outputScrollTop: 1000000 + Date.now(),
      });
    } catch (error) {
      if (isFatalSetupError(error)) this.backToSetup();
    }
  },
  checkPrompt() {
    if (this.confirmOpen) return;
    findConfirmingSession()
      .then((session) => {
        if (!session) {
          this.confirmOpen = false;
          return;
        }
        this.confirmOpen = true;
        wx.navigateTo({ url: `/pages/confirm/index?id=${encodeURIComponent(session.id)}` });
      })
      .catch((error) => {
        if (isFatalSetupError(error)) this.backToSetup();
      });
  },
  backToSetup() {
    wx.redirectTo({ url: '/pages/setup/index?edit=1' });
  },
  // ---- Wake（系统级唤醒：onVoiceWakeup）----
  onVoiceWakeup() {
    if (!this.data.draft && this.data.state === 'idle') this.startCommandListening();
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
      this.handleSpoken(raw);
    };
    recognition.onerror = () => {
      this.commandRecognition = null;
      this.setData({ state: 'idle', hint: '没听清，请再说一次' });
    };
    recognition.onend = () => {
      this.commandRecognition = null;
      if (this.data.state === 'listening') {
        this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿说话' });
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
  handleSpoken(raw) {
    const spoken = (raw || '').trim();
    if (!spoken) {
      this.setData({ state: 'idle', hint: '说"乐奇"或点击镜腿说话' });
      return;
    }
    if (/切换模式/.test(spoken)) {
      if (/透明/.test(spoken)) {
        wx.redirectTo({ url: '/pages/transparent/index' });
      } else {
        wx.redirectTo({ url: '/pages/assistant/index' });
      }
      return;
    }
    if (/透明模式/.test(spoken)) {
      wx.redirectTo({ url: '/pages/transparent/index' });
      return;
    }
    if (/^(?:切换|切|换).*(?:会话|回话|绘画|会)|会话列表/.test(spoken)) {
      wx.redirectTo({ url: '/pages/sessions/index' });
      return;
    }
    if (/发送/.test(spoken) && this.data.draft) {
      this.submitDraft();
      return;
    }
    const edited = applyDraftEdit(this.data.draft, spoken);
    if (edited.changed) {
      this.setData({
        draft: edited.value,
        state: 'idle',
        hint: edited.value ? '已修改待输入，说"发送"提交' : '待输入已清空',
      });
      return;
    }
    const next = this.data.draft ? this.data.draft + spoken : spoken;
    this.setData({
      draft: next,
      state: 'idle',
      hint: '已填入待输入，说"把X改成Y"修改，说"发送"提交',
    });
  },
  submitDraft() {
    const text = this.data.draft.trim();
    if (!text) return;
    this.setData({ state: 'busy', hint: '正在发送…' });
    sendSessionInput(this.data.sessionId, text)
      .then(() => {
        this.setData({ draft: '', state: 'idle', hint: '已发送' });
        this.refreshOutput();
      })
      .catch((error) => {
        if (isFatalSetupError(error)) {
          this.backToSetup();
          return;
        }
        this.setData({ state: 'idle', hint: `发送失败：${error.message}` });
      });
  },
  onKeyDown(event) {
    if (event.code !== 'GlobalHook') return;
    if (this.data.draft) this.submitDraft();
    else if (this.data.state === 'idle') this.startCommandListening();
  },
};

function applyDraftEdit(draft, spoken) {
  let match = spoken.match(/^把所有(.+?)改成(.+)$/);
  if (match && draft.includes(match[1])) {
    return { changed: true, value: draft.split(match[1]).join(match[2]) };
  }
  match = spoken.match(/^把(.+?)改成(.+)$/);
  if (match && draft.includes(match[1])) {
    return { changed: true, value: draft.replace(match[1], match[2]) };
  }
  match = spoken.match(/^删除(.+)$/);
  if (match && draft.includes(match[1])) {
    return { changed: true, value: draft.replace(match[1], '') };
  }
  if (/^清空$/.test(spoken) && draft) return { changed: true, value: '' };
  match = spoken.match(/^(?:加上|追加)(.+)$/);
  if (match) return { changed: true, value: draft + match[1] };
  return { changed: false, value: draft };
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}
</script>

<page>
  <view class="page">
    <view class="header">
      <text class="session">{{sessionName}}（TUI）</text>
      <text class="mode-hint">说"切换模式"回助手</text>
    </view>
    <scroll-view class="terminal" scroll-y="true" scroll-top="{{outputScrollTop}}">
      <view ink:for="{{lines}}" ink:key="id" class="term-row">
        <text class="term-line">{{item.text || ' '}}</text>
      </view>
      <view ink:if="{{lines.length === 0}}" class="term-row">
        <text class="term-line">暂无输出</text>
      </view>
    </scroll-view>
    <view class="draft-box">
      <text class="hint-inline">{{hint}}</text>
      <text class="draft-text">{{draft || '（空）'}}</text>
    </view>
  </view>
</page>

<style>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px;
}
.header {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 4px;
}
.session {
  color: #40ff5e;
  font-size: 15px;
  font-weight: 500;
}
.mode-hint {
  color: rgba(64, 255, 94, 0.48);
  font-size: 10px;
}
.terminal {
  flex-grow: 1;
  flex-basis: 0;
  border: 1px solid rgba(64, 255, 94, 0.24);
  border-radius: 6px;
  padding: 4px;
}
.term-row {
  padding: 1px 2px;
}
.term-line {
  color: rgba(64, 255, 94, 0.72);
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
}
.draft-box {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  border: 1px solid rgba(64, 255, 94, 0.72);
  border-radius: 4px;
  background-color: rgba(64, 255, 94, 0.12);
  padding: 4px 6px;
  margin-top: 4px;
}
.hint-inline {
  flex-shrink: 0;
  margin-right: 6px;
  color: rgba(64, 255, 94, 0.48);
  font-size: 11px;
}
.draft-text {
  flex-grow: 1;
  flex-basis: 0;
  color: #40ff5e;
  font-size: 12px;
}
</style>
