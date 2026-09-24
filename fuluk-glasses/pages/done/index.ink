<script def>
{
  "navigationBarTitleText": "已完成"
}
</script>

<script setup>
import wx from 'wx';
import { getConfig } from '../../lib/store.js';

export default {
  data: {
    sessionName: '',
    hint: '点头或确认键关闭',
  },
  onLoad(query) {
    if (!getConfig()) {
      wx.redirectTo({ url: '/pages/setup/index' });
      return;
    }
    const sessionName = query.name ? decodeURIComponent(query.name) : '';
    this.setData({ sessionName });
    this.enableWorldAwareness();
  },
  close() {
    wx.navigateBack({
      fail() {
        wx.redirectTo({ url: '/pages/assistant/index' });
      },
    });
  },
  onHeadGesture(event) {
    if (event.gesture === 'nod') this.close();
  },
  onKeyUp(event) {
    if (event.code === 'Enter' || event.code === 'Backspace') {
      event.preventDefault();
      this.close();
    }
  },
};
</script>

<page>
  <view class="page">
    <view class="header">
      <text class="marker">✓</text>
      <text class="title">会话已完成</text>
    </view>
    <text class="name">{{sessionName}}</text>
    <text class="hint">{{hint}}</text>
    <view class="actions">
      <button class="btn btn-close" bindtap="close">关闭</button>
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
  margin-bottom: 12px;
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
.name {
  color: rgba(64, 255, 94, 0.72);
  font-size: 14px;
  margin-bottom: 12px;
}
.hint {
  color: rgba(64, 255, 94, 0.48);
  font-size: 11px;
  margin-bottom: 12px;
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
.btn-close {
  border: 1px solid #40ff5e;
  color: #40ff5e;
}
</style>
