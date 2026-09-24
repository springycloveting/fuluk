# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Session Gateway, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email security details to the project maintainer
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if available)

We will respond within 48 hours and provide a timeline for the fix.

---

## Security Features

### Authentication

Session Gateway uses Bearer token authentication for all API endpoints (except `/health`).

**Configuration:**
```bash
# REQUIRED: Set a secure random token
SESSION_GATEWAY_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

**Security measures:**
- Constant-time token comparison (prevents timing attacks)
- No default insecure tokens allowed
- Token length validation (minimum 16 characters recommended)

### Rate Limiting

The server implements IP-based rate limiting to prevent:
- Brute force attacks
- Denial of service attacks
- Session enumeration

**Default limits:**
- 100 requests per minute per IP address
- Configurable via code modification

### Runtime Mode Protection

Runtime sessions allow arbitrary shell command execution. This is **disabled by default**.

**To enable (with caution):**
```bash
SESSION_GATEWAY_ALLOW_RUNTIME=true
```

**Warning:** Only enable runtime mode if you trust ALL authenticated users, as they can execute any shell command on the server.

### Security Headers

All HTTP responses include security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (restricts browser features)

### API Key Management

The AI command parser API key is configured through the web UI:
- Stored in `session-gateway-settings.json`
- The settings file should have restricted file permissions
- Users need to see their configured key in the UI (not masked)

**Recommendations:**
- Restrict file permissions on the settings file:
  ```bash
  chmod 600 /var/lib/session-gateway/session-gateway-settings.json
  ```
- The settings directory should not be accessible via web server

### Path Traversal Prevention

Static file serving includes:
- Path resolution against public directory
- Symlink resolution to prevent bypass
- Explicit path prefix validation

---

## Security Best Practices

### Deployment

1. **Always set a strong token:**
   ```bash
   SESSION_GATEWAY_TOKEN=$(openssl rand -hex 32)
   ```

2. **Run behind a reverse proxy** (nginx, Caddy, Traefik) with:
   - HTTPS termination
   - Additional rate limiting
   - Request logging

3. **Restrict network access:**
   - Bind to `127.0.0.1` if using a reverse proxy
   - Use firewall rules to limit access

4. **Disable runtime mode** (default):
   ```bash
   SESSION_GATEWAY_ALLOW_RUNTIME=false
   ```

5. **Use environment variables for secrets:**
   ```bash
   SESSION_GATEWAY_TOKEN=your-secure-token
   ```

6. **Restrict settings file permissions:**
   ```bash
   chmod 600 /var/lib/session-gateway/session-gateway-settings.json
   ```

### Monitoring

1. **Enable audit logging** (if implemented)
2. **Monitor failed authentication attempts**
3. **Log runtime mode warnings** at startup

### Updates

Keep the server updated to receive security patches.

---

## Known Security Considerations

### tmux Access

Sessions run in tmux, which provides:
- Process isolation between sessions
- No container-level isolation; CLIs run directly on the host

### Shell Command Injection

While the system sanitizes inputs, users with session access can:
- Execute CLI commands (codex, claude, opencode)
- In runtime mode: execute arbitrary shell commands

**Mitigation:** Grant access only to trusted users.

---

## Security Changelog

### 2026-05-23 - Security Audit Fixes

**Fixed:**
- Removed weak default token (`dev-token`)
- Implemented constant-time authentication comparison
- Added rate limiting (100 req/min per IP)
- Added security headers to all responses
- Protected API keys in responses
- Enhanced path traversal protection with realpath
- Added runtime mode security warning and opt-in

**Added:**
- `SESSION_GATEWAY_ALLOW_RUNTIME` configuration
- `SESSION_GATEWAY_AI_API_KEY` environment variable
- Security warning banner for runtime mode

---

## Security Configuration Checklist

Before deploying to production:

- [ ] `SESSION_GATEWAY_TOKEN` is set to a secure random value (32+ hex characters)
- [ ] `SESSION_GATEWAY_ALLOW_RUNTIME` is `false` (or explicitly enabled with caution)
- [ ] Server runs behind HTTPS reverse proxy
- [ ] Database and settings files are outside web root
- [ ] File permissions restrict access to data directory
- [ ] Rate limiting is active (default)
- [ ] Audit logging is configured (if available)

---

*Last updated: 2026-05-23*
