import wx from 'wx';

const CONFIG_KEY = 'fuluk_config';
const SESSION_KEY = 'fuluk_session';
const CHAT_PREFIX = 'fuluk_chat_';
const MAX_CHAT = 10;

export function getConfig() {
  const config = wx.getStorageSync(CONFIG_KEY);
  if (!config || !config.host || !config.port) return null;
  return {
    host: String(config.host).trim(),
    port: String(config.port).trim(),
    token: String(config.token ?? '').trim(),
  };
}

export function saveConfig(config) {
  wx.setStorageSync(CONFIG_KEY, {
    host: String(config.host).trim(),
    port: String(config.port).trim(),
    token: String(config.token ?? '').trim(),
  });
}

export function getSession() {
  const session = wx.getStorageSync(SESSION_KEY);
  if (!session || !session.id) return null;
  return { id: String(session.id), name: String(session.name ?? session.id) };
}

export function saveSession(session) {
  wx.setStorageSync(SESSION_KEY, {
    id: String(session.id),
    name: String(session.name ?? session.id),
  });
}

export function loadChatHistory(sessionId) {
  const data = wx.getStorageSync(CHAT_PREFIX + sessionId);
  if (!data || !Array.isArray(data.messages)) return { messages: [], seq: 0 };
  return { messages: data.messages, seq: data.seq || 0 };
}

export function saveChatHistory(sessionId, messages, seq) {
  const trimmed = messages.length > MAX_CHAT
    ? messages.slice(messages.length - MAX_CHAT)
    : messages;
  wx.setStorageSync(CHAT_PREFIX + sessionId, { messages: trimmed, seq: seq || 0 });
}
