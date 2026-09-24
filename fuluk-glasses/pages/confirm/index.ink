<script def>
{
  "navigationBarTitleText": "需要确认"
}
</script>

<script setup>
import wx from 'wx';
import { getConfig } from '../../lib/store.js';
import { getPrompt, resolveChoice, isFatalSetupError } from '../../lib/gateway.js';

export default {
  data: {
    sessionId: '',
    context: '',
    busy: false,
    loading: true,
    error: '',
    hint: '点头或确认键同意，返回键拒绝',
  },
  pollTimer: null,
  onLoad(query) {
    this.openedByRedirect = query.redirect === '1';
    if (!getConfig()) {
      wx.redirectTo({ url: '/pages/setup/index' });
      return;
    }
    const sessionId = query.id ? decodeURIComponent(query.id) : '';
    if (!sessionId) {
      wx.navigateBack();
      return;
    }
    this.setData({ sessionId });
    this.enableWorldAwareness();
    this.refresh();
    this.pollTimer = setInterval(() => this.refresh(true), 3000);
  },
  onUnload() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  },
  refresh(silent) {
    getPrompt(this.data.sessionId)
      .then((body) => {
        if (!body || !body.needsConfirmation) {
          if (this.pollTimer) clearInterval(this.pollTimer);
          wx.navigateBack();
          return;
        }
        this.prompt = body;
        this.setData({ context: body.context || '', loading: false, error: '' });
      })
      .catch((error) => {
        if (isFatalSetupError(error)) {
          wx.redirectTo({ url: '/pages/setup/index?edit=1' });
        } else if (!silent) {
          this.setData({ loading: false, error: error.message });
        }
      });
  },
  approve() {
    this.resolve('approve');
  },
  reject() {
    this.resolve('reject');
  },
  resolve(kind) {
    if (this.data.busy || !this.prompt) return;
    const choice = this.prompt.choices && this.prompt.choices[kind];
    if (!choice) {
      this.setData({ error: '缺少选项信息' });
      return;
    }
    this.setData({ busy: true, hint: kind === 'approve' ? '正在同意…' : '正在拒绝…' });
    resolveChoice(this.data.sessionId, choice)
      .then(() => {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.finishAndReturn();
      })
      .catch((error) => this.setData({ busy: false, error: error.message }));
  },
  finishAndReturn() {
    wx.navigateBack({
      fail() {
        wx.redirectTo({ url: '/pages/assistant/index' });
      },
    });
  },
  onHeadGesture(event) {
    if (event.gesture === 'nod') this.approve();
  },
  onKeyUp(event) {
    if (event.code === 'Enter') {
      event.preventDefault();
      this.approve();
    }
    if (event.code === 'Backspace') {
      event.preventDefault();
      this.reject();
    }
  },
};
</script>

<page>
  <view class="page">
    <view class="header">
      <text class="marker">!</text>
      <text class="title">会话需要确认</text>
    </view>
    <text class="state" ink:if="{{loading}}">加载中…</text>
    <scroll-view class="context" scroll-y="true">
      <text class="context-text">{{context}}</text>
    </scroll-view>
    <text class="error" ink:if="{{error}}">错误：{{error}}</text>
    <text class="hint">{{hint}}</text>
    <view class="actions">
      <button class="btn btn-approve" bindtap="approve" disabled="{{busy}}">同意</button>
      <button class="btn btn-reject" bindtap="reject" disabled="{{busy}}">拒绝</button>
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
  margin-bottom: 8px;
}
.marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 1px solid #40ff5e;
  border-radius: 2px;
  color: #40ff5e;
  font-size: 13px;
  font-weight: 500;
  margin-right: 8px;
}
.title {
  color: #40ff5e;
  font-size: 16px;
  font-weight: 500;
}
.state {
  color: rgba(64, 255, 94, 0.48);
  font-size: 13px;
}
.context {
  flex-grow: 1;
  flex-basis: 0;
  border: 1px solid rgba(64, 255, 94, 0.24);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 6px;
}
.context-text {
  color: rgba(64, 255, 94, 0.72);
  font-family: monospace;
  font-size: 11px;
}
.error {
  color: #40ff5e;
  font-size: 12px;
  height: 15px;
}
.hint {
  color: rgba(64, 255, 94, 0.48);
  font-size: 11px;
  margin-bottom: 6px;
}
.actions {
  display: flex;
  flex-direction: row;
}
.btn {
  flex-grow: 1;
  flex-basis: 0;
  border-radius: 4px;
  padding: 10px;
  font-size: 14px;
}
.btn-approve {
  margin-right: 8px;
  border: 1px solid #40ff5e;
  color: #40ff5e;
}
.btn-reject {
  border: 1px solid rgba(64, 255, 94, 0.48);
  color: rgba(64, 255, 94, 0.72);
}
</style>
