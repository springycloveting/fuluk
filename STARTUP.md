# Session Gateway 启动指南

## 环境变量

```bash
HOST=0.0.0.0
SESSION_GATEWAY_TOKEN='<YOUR_TOKEN>'
```

## 启动命令

```bash
# 方式一：直接启动（如果端口空闲）
HOST=0.0.0.0 SESSION_GATEWAY_TOKEN='<YOUR_TOKEN>' npm run dev

# 方式二：重启服务（先杀掉旧进程）
pkill -f "node src/server.mjs"; sleep 2 && HOST=0.0.0.0 SESSION_GATEWAY_TOKEN='<YOUR_TOKEN>' npm run dev
```

## 注意事项

1. **端口占用**：如果启动失败提示 `EADDRINUSE`，说明端口 8787 被占用，需要先杀掉旧进程：
   ```bash
   pkill -f "node src/server.mjs"
   ```
   然后等待 2 秒让端口完全释放后再启动。

2. **后台运行**：使用 `run_in_background` 或 `&` 让服务在后台运行。

3. **验证启动成功**：
   ```bash
   lsof -i :8787
   # 或
   curl http://localhost:8787/health
   ```

## API 调用

所有 API 请求需要携带 Token：

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" http://localhost:8787/api/sessions
```
