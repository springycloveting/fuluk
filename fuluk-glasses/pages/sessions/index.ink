<script def>
{
  "navigationBarTitleText": "切换会话"
}
</script>

<script setup>
import wx from 'wx';
import { getConfig, saveSession } from '../../lib/store.js';
import { listSessions, isFatalSetupError } from '../../lib/gateway.js';

export default {
  data: {
    sessions: [],
    index: 0,
    loading: true,
    error: '',
    listening: false,
    hint: '后滑下移，前滑上移，长按确认',
    totalCount: 0,
    openCount: 0,
  },
  recognition: null,
  onLoad() {
    if (!getConfig()) {
      wx.redirectTo({ url: '/pages/setup/index' });
      return;
    }
    this.refresh();
  },
  onUnload() {
    this.stopListening();
  },
  refresh() {
    this.setData({ loading: true, error: '' });
    listSessions()
      .then((sessions) => {
        const isOpen = (item) =>
          item.phase === 'active' ||
          item.phase === 'stopped' ||
          item.phase === 'running' ||
          (!item.phase && (item.status === 'running' || item.status === 'active'));
        const open = sessions
          .filter(isOpen)
          .map((item) => ({
            id: item.id,
            name: item.name || item.id,
            phase: item.phase || (item.status === 'running' ? 'active' : ''),
          }));
        this.setData({
          sessions: open,
          index: Math.min(this.data.index, Math.max(0, open.length - 1)),
          loading: false,
          totalCount: sessions.length,
          openCount: open.length,
          hint: '后滑下移，前滑上移，长按确认',
        });
      })
      .catch((error) => {
        if (isFatalSetupError(error)) {
          wx.redirectTo({ url: '/pages/setup/index?edit=1' });
        } else {
          this.setData({ loading: false, error: error.message });
        }
      });
  },
  moveCursor(step) {
    const count = this.data.sessions.length;
    if (!count) return;
    this.setData({ index: (this.data.index + step + count) % count });
  },
  choose() {
    const session = this.data.sessions[this.data.index];
    if (!session) return;
    this.stopListening();
    saveSession(session);
    wx.redirectTo({ url: '/pages/assistant/index' });
  },
  // ---- Voice name matching ----
  startListening() {
    if (this.recognition || this.data.listening) return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.resultIndex];
      const spoken = result && result[0] ? result[0].transcript.trim() : '';
      this.recognition = null;
      this.setData({ listening: false });
      if (spoken) this.matchName(spoken);
    };
    recognition.onerror = () => {
      this.recognition = null;
      this.setData({ listening: false });
    };
    recognition.onend = () => {
      this.recognition = null;
      this.setData({ listening: false });
    };
    this.recognition = recognition;
    try {
      recognition.start();
      this.setData({ listening: true, hint: '请说出会话名称…' });
    } catch {
      this.recognition = null;
    }
  },
  stopListening() {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
      this.recognition = null;
    }
    this.setData({ listening: false });
  },
  matchName(spoken) {
    const query = spoken.replace(/\s+/g, '').toLowerCase();
    const names = this.data.sessions.map((item) => item.name.replace(/\s+/g, '').toLowerCase());
    let found = names.findIndex((name) => name === query);
    if (found < 0) found = names.findIndex((name) => name.includes(query) || query.includes(name));
    if (found < 0) {
      this.setData({ hint: `没有找到"${spoken}"，请再说或滑动选择` });
      return;
    }
    this.setData({ index: found, hint: `已选中"${this.data.sessions[found].name}"，长按确认` });
  },
  onKeyDown(event) {
    if (event.code === 'ArrowDown') {
      this.moveCursor(1);
      return;
    }
    if (event.code === 'ArrowUp') {
      this.moveCursor(-1);
      return;
    }
    if (event.code === 'GlobalHook') {
      this.startListening();
      return;
    }
  },
  onKeyUp(event) {
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      return;
    }
    if (event.code === 'Enter') {
      event.preventDefault();
      this.choose();
      return;
    }
    if (event.code === 'Backspace') {
      event.preventDefault();
      return;
    }
  },
};
</script>

<page>
  <view class="page">
    <text class="title">切换会话</text>
    <text class="diag">共 {{totalCount}} 个，可切换 {{openCount}} 个</text>
    <text class="state" ink:if="{{loading}}">加载中…</text>
    <text class="state" ink:if="{{error}}">错误：{{error}}</text>
    <text class="state" ink:if="{{!loading && !error && sessions.length === 0}}">没有可切换的会话</text>
    <scroll-view ink:if="{{sessions.length}}" class="list" scroll-y="true" scroll-into-view="#row-{{index}}">
      <view
        ink:for="{{sessions}}"
        ink:for-index="rowIndex"
        ink:key="id"
        id="row-{{rowIndex}}"
        class="row {{index === rowIndex ? 'row-active' : ''}}"
      >
        <text ink:if="{{index === rowIndex}}" class="cursor">></text>
        <text class="name">{{item.name}}</text>
        <text class="phase">（{{item.phase === 'active' ? '进行中' : '已停止'}}）</text>
      </view>
    </scroll-view>
    <text class="hint">{{hint}}</text>
  </view>
</page>

<style>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}
.title {
  color: #40ff5e;
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}
.diag {
  color: rgba(64, 255, 94, 0.48);
  font-size: 11px;
  margin-bottom: 6px;
}
.state {
  color: rgba(64, 255, 94, 0.48);
  font-size: 13px;
  padding: 8px 0;
}
.list {
  flex-grow: 1;
  flex-basis: 0;
}
.row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  padding: 8px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
}
.row-active {
  border-color: rgba(64, 255, 94, 0.72);
  background-color: rgba(64, 255, 94, 0.12);
}
.cursor {
  color: #40ff5e;
  font-family: monospace;
  margin-right: 6px;
}
.name {
  color: rgba(64, 255, 94, 0.72);
  font-size: 14px;
}
.phase {
  color: rgba(64, 255, 94, 0.48);
  font-size: 12px;
  margin-left: 4px;
}
.hint {
  color: rgba(64, 255, 94, 0.48);
  font-size: 11px;
  height: 15px;
  margin-top: 6px;
}
</style>
