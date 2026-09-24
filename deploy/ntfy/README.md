# ntfy for Fuluk Gateway

本地 ntfy 通知服务，供 Fuluk APP 内置前台服务订阅。手机无需安装 ntfy APP。

## 部署信息

| 项目 | 值 |
|------|-----|
| ntfy 服务器 | `http://192.168.0.55:8099` |
| Topic | `fuluk` |
| 容器名 | `fuluk-ntfy` |
| 镜像 | `binwiederhier/ntfy:latest` |
| 健康检查 | `http://192.168.0.55:8099/v1/health` |

## 常用命令

```bash
# 启动 / 停止 / 重启
docker compose -f deploy/ntfy/docker-compose.yml up -d
docker compose -f deploy/ntfy/docker-compose.yml down
docker compose -f deploy/ntfy/docker-compose.yml restart

# 查看日志
docker logs -f fuluk-ntfy

# 手动发一条测试消息
curl -H "Title: 测试" -d "hello" http://192.168.0.55:8099/fuluk
```

容器配置了 `restart: unless-stopped`，Docker 开机自启时会自动恢复。

## 网关配置

网关在 `data/session-gateway-settings.json` 的 `notifications.ntfy` 指向本服务；
也可在 APP 设置页填写后由 `PUT /api/config` 写入：

```json
{
  "notifications": {
    "ntfy": {
      "server": "http://192.168.0.55:8099",
      "topic": "fuluk",
      "token": "",
      "enabled": true
    }
  }
}
```

## 安全说明

当前为局域网部署，Topic 为开放读写（`auth-default-access: read-write`）。
同一网络内知道 Topic 的人可订阅/发布。建议：

- 使用不易猜测的 Topic 名；
- 如需账号鉴权，在配置中挂载 auth 文件并设置
  `auth-file: /var/lib/ntfy/user.db`、`auth-default-access: "deny-all"`，
  然后用 `docker exec fuluk-ntfy ntfy user add <name>` 创建用户，
  APP 侧在 ntfy Token 处填写 `tk_...`（在 Web UI 的「Account」生成）。
