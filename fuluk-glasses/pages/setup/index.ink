<script def>
{
  "navigationBarTitleText": "眼镜配对"
}
</script>

<script setup>
import wx from 'wx';
import { getConfig, saveConfig } from '../../lib/store.js';

const PAIR_POLL_MS = 3000;

export default {
  data: {
    stage: 'intro',
    host: '',
    port: '',
    listening: false,
    status: '请按确认键开始语音配置',
    hint: '只需说地址和端口，无需输入 token',
    pairKeyShort: '',
  },
  recognition: null,
  pollTimer: null,
  pairKey: '',
  onLoad(query) {
    if (query.edit === '1') {
      this.gotoIntro();
      return;
    }
    const config = getConfig();
    if (!config) {
      this.gotoIntro();
      return;
    }
    this.setData({ stage: 'checking', status: '正在检查已保存的连接…', hint: '' });
    fetch(`http://${config.host}:${config.port}/health`)
      .then((response) => {
        if (!response.ok) throw new Error('health failed');
        wx.redirectTo({ url: '/pages/assistant/index' });
      })
      .catch(() => this.gotoIntro());
  },
  onUnload() {
    this.stopPolling();
    this.abortRecognition();
  },
  gotoIntro() {
    this.setData({
      stage: 'intro',
      host: '',
      port: '',
      pairKeyShort: '',
      status: '请按确认键开始语音配置',
      hint: '只需说地址和端口，无需输入 token',
    });
  },
  restart() {
    this.stopPolling();
    this.gotoIntro();
  },
  generateKey() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  },
  formatKeyShort(key) {
    return key.slice(0, 6).match(/.{2}/g).join(' ');
  },
  askHost() {
    this.setData({
      stage: 'host',
      status: '请说出服务器地址，例如十点零，六十四点零点七',
      hint: '说"点"即可，确认键开始',
    });
  },
  askPort() {
    this.setData({
      stage: 'port',
      status: '请说出端口，例如八七八七',
      hint: '确认键开始',
    });
  },
  askSummaryConfirm() {
    this.setData({
      stage: 'summary',
      status: `地址 ${this.data.host}，端口 ${this.data.port}。说"是"开始配对，说"不"重输`,
      hint: '确认键开始说话',
    });
  },
  startPairing() {
    const key = this.generateKey();
    this.pairKey = key;
    const keyShort = this.formatKeyShort(key);
    this.setData({
      stage: 'pairing',
      pairKeyShort: keyShort,
      status: '正在向网关发起配对…',
      hint: '',
    });
    fetch(`http://${this.data.host}:${this.data.port}/api/glass/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, name: 'Rokid Glasses' }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`pair failed (${response.status})`);
        this.setData({
          status: `密钥前6位: ${this.data.pairKeyShort}\n请在电脑 Web 端「配置 → AI眼镜认证」中批准`,
          hint: '正在等待批准…',
        });
        this.startPolling();
      })
      .catch((error) => {
        this.setData({
          stage: 'error',
          status: `无法连接网关：${error.message}`,
          hint: '确认眼镜与服务器网络互通后，按确认键重试',
        });
      });
  },
  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.pollStatus(), PAIR_POLL_MS);
    this.pollStatus();
  },
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },
  pollStatus() {
    const url = `http://${this.data.host}:${this.data.port}/api/glass/status?key=${encodeURIComponent(this.pairKey)}`;
    fetch(url)
      .then((response) => response.json())
      .then((body) => {
        if (body.status === 'approved') {
          this.stopPolling();
          saveConfig({ host: this.data.host, port: this.data.port, token: this.pairKey });
          this.setData({ stage: 'done', status: '配对成功，正在进入…', hint: '' });
          wx.redirectTo({ url: '/pages/sessions/index' });
        } else if (body.status === 'expired' || body.status === 'unknown') {
          this.stopPolling();
          this.setData({
            stage: 'error',
            status: body.status === 'expired' ? '配对请求已过期（10 分钟）' : '配对请求不存在',
            hint: '按确认键重新发起',
          });
        }
      })
      .catch(() => {});
  },
  startListening() {
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const result = event.results[event.resultIndex];
      const raw = result && result[0] ? result[0].transcript : '';
      this.setData({ listening: false });
      this.handleAnswer(raw);
    };
    recognition.onerror = (event) => {
      this.setData({
        listening: false,
        hint: `没听清（${event.error || '识别失败'}），请按确认键重试`,
      });
    };
    recognition.onend = () => this.setData({ listening: false });
    this.recognition = recognition;
    recognition.start();
    this.setData({ listening: true, hint: '正在聆听…' });
  },
  abortRecognition() {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
      this.recognition = null;
    }
  },
  normalizeHost(raw) {
    return raw.replace(/\s+/g, '').replace(/点/g, '.').replace(/。|，|、/g, '');
  },
  normalizePort(raw) {
    return raw.replace(/\s+/g, '').replace(/[^\d]/g, '');
  },
  classifyYesNo(raw) {
    const text = (raw || '').replace(/\s+/g, '');
    if (/不|否|错/i.test(text)) return 'no';
    if (/是|对|确认|没错|正确|嗯/i.test(text)) return 'yes';
    return 'unknown';
  },
  handleAnswer(raw) {
    const text = (raw || '').trim();
    if (!text) {
      this.setData({ hint: '没听清，请按确认键重试' });
      return;
    }
    if (this.data.stage === 'host') {
      const host = this.normalizeHost(text);
      if (!host || !/\d+\.\d+/.test(host)) {
        this.setData({ hint: '没有识别到地址，请按确认键重试' });
        return;
      }
      this.setData({ host });
      this.askPort();
      return;
    }
    if (this.data.stage === 'port') {
      const port = this.normalizePort(text);
      if (!port) {
        this.setData({ hint: '没有识别到端口，请按确认键重试' });
        return;
      }
      this.setData({ port });
      this.askSummaryConfirm();
      return;
    }
    if (this.data.stage === 'summary') {
      const answer = this.classifyYesNo(text);
      if (answer === 'no') {
        this.setData({ host: '', port: '' });
        this.askHost();
        return;
      }
      if (answer === 'unknown') {
        this.setData({ hint: '请明确说"是"或"不"' });
        return;
      }
      this.startPairing();
    }
  },
  primaryAction() {
    if (this.data.listening) {
      this.recognition && this.recognition.stop();
      return;
    }
    if (this.data.stage === 'intro' || this.data.stage === 'checking') {
      this.askHost();
      return;
    }
    if (this.data.stage === 'host' || this.data.stage === 'port' || this.data.stage === 'summary') {
      this.startListening();
      return;
    }
    if (this.data.stage === 'error') {
      if (this.data.host && this.data.port) this.startPairing();
      else this.askHost();
    }
  },
  onKeyUp(event) {
    if (event.code === 'Enter') {
      event.preventDefault();
      this.primaryAction();
    }
  },
};
</script>

<page>
  <view class="page">
    <text class="title">AI 眼镜配对</text>
    <view class="card">
      <text class="status">{{status}}</text>
      <text class="hint">{{listening ? '正在聆听…' : hint}}</text>
    </view>
    <view ink:if="{{stage === 'pairing' || stage === 'error'}}" class="key-box">
      <text class="key-label">密钥前6位</text>
      <text class="key-value">{{pairKeyShort}}</text>
    </view>
    <button class="primary-btn" bindtap="primaryAction">
      {{listening ? '停止聆听' : stage === 'pairing' ? '等待批准中' : '确认键 / 点按继续'}}
    </button>
    <button ink:if="{{stage === 'pairing' || stage === 'error'}}" class="ghost-btn" bindtap="restart">重新开始</button>
  </view>
</page>

<style>
.page {
  display: flex;
  flex-direction: column;
  padding: 12px;
}
.title {
  color: #40ff5e;
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 14px;
}
.card {
  border: 1px solid rgba(64, 255, 94, 0.24);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
}
.status {
  color: rgba(64, 255, 94, 0.72);
  font-size: 14px;
  margin-bottom: 8px;
}
.hint {
  color: rgba(64, 255, 94, 0.48);
  font-size: 12px;
}
.key-box {
  border: 1px solid rgba(64, 255, 94, 0.48);
  border-radius: 4px;
  padding: 10px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.key-label {
  color: rgba(64, 255, 94, 0.48);
  font-size: 11px;
  margin-bottom: 4px;
}
.key-value {
  color: #40ff5e;
  font-size: 20px;
  font-weight: 500;
}
.primary-btn {
  border: 1px solid #40ff5e;
  border-radius: 4px;
  background-color: rgba(64, 255, 94, 0.12);
  padding: 12px;
  color: #40ff5e;
  font-size: 14px;
}
.ghost-btn {
  margin-top: 8px;
  border: 1px solid rgba(64, 255, 94, 0.48);
  border-radius: 4px;
  padding: 10px;
  color: rgba(64, 255, 94, 0.72);
  font-size: 13px;
}
</style>
