import { getConfig } from './store.js';
import wx from 'wx';

export function baseUrl() {
  const config = getConfig();
  if (!config) throw new Error('网关未配置');
  return `http://${config.host}:${config.port}`;
}

function request(path, options = {}) {
  const config = getConfig();
  if (!config) return Promise.reject(new Error('网关未配置'));

  const header = Object.assign({}, options.headers || {});
  if (config.token) header['Authorization'] = `Bearer ${config.token}`;

  const method = (options.method || 'GET').toUpperCase();
  const reqData = options.body != null ? options.body : undefined;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl()}${path}`,
      method,
      header,
      data: reqData,
      timeout: options.timeout || 60000,
      dataType: 'json',
      success(res) {
        const statusCode = res.statusCode;
        let body = res.data;
        // wx.request with dataType:'json' auto-parses; fallback for non-JSON text
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch {
            // keep as text
          }
        }
        if (statusCode < 200 || statusCode >= 300) {
          const message = body && typeof body === 'object' ? body.error || body.message : body;
          reject(new Error(`请求失败 (${statusCode})${message ? `：${message}` : ''}`));
          return;
        }
        resolve(body);
      },
      fail(err) {
        const errMsg = (err && err.errMsg) || '请求失败';
        reject(new Error(errMsg));
      },
    });
  });
}

export function checkHealth() {
  return request('/health');
}

export function listSessions() {
  return request('/api/sessions').then((body) => body.sessions || []);
}

export function sendSessionInput(sessionId, text) {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export function fetchSessionOutput(sessionId, lines) {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/output?lines=${lines}`);
}

export function getPrompt(sessionId) {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/prompt?lines=80`);
}

export function findConfirmingSession() {
  return listSessions().then(
    (sessions) => sessions.find((item) => item.taskState === 'needs_confirmation') || null
  );
}

export function findAlertSession(excludeCompletedIds = []) {
  return listSessions().then((sessions) => {
    const completedIds = sessions
      .filter((item) => item.taskState === 'completed')
      .map((item) => item.id);
    const confirming = sessions.find((item) => item.taskState === 'needs_confirmation');
    if (confirming) return { type: 'confirm', session: confirming, completedIds };
    const completed = sessions.find(
      (item) => item.taskState === 'completed' && !excludeCompletedIds.includes(item.id)
    );
    return completed
      ? { type: 'done', session: completed, completedIds }
      : { type: null, completedIds };
  });
}

export function resolveChoice(sessionId, choice) {
  const body = choice.send === 'keys' ? { keys: choice.keys } : { text: choice.value };
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/${choice.send}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function askAssistant(text, currentSessionId) {
  return request('/api/nl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, currentSessionId }),
  });
}

export function answerText(body) {
  if (!body || typeof body !== 'object') return String(body ?? '');
  return (
    body.answer ||
    body.help ||
    body.message ||
    body.summary ||
    JSON.stringify(body)
  );
}

export function isFatalSetupError(error) {
  const message = (error && error.message) || String(error || '');
  if (/\((?:401|404)\)/.test(message)) return true;
  return /Failed to fetch|fetch failed|NetworkError|ENOTFOUND|ECONNREFUSED|网关未配置|request:fail|timeout/i.test(message);
}
