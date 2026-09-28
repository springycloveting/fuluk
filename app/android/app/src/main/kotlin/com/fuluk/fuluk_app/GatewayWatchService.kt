package com.fuluk.fuluk_app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

class GatewayWatchService : Service() {

    private var running = false
    private var webSocket: WebSocket? = null
    private var backoff = 2000L
    private val overlays = mutableMapOf<String, android.view.View>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_TEST_OVERLAY -> {
                createChannels()
                showOverlay("会话:测试 需要审核", "__test__", "这是会话内容预览的示例。\n真实审核时会显示待确认命令附近的终端输出，供你判断是否同意。")
                return START_NOT_STICKY
            }
            else -> start()
        }
        return START_STICKY
    }

    private fun start() {
        if (running) return
        createChannels()
        startForeground(NOTIFY_LISTEN, buildListenNotification())
        @Suppress("DEPRECATION")
        stopForeground(true)
        running = true
        connect()
    }

    private fun gatewayConfig(): GatewayConfig? {
        val prefs = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
        val host = prefs.getString("flutter.gatewayHost", null)?.trim().orEmpty()
        val port = prefs.getString("flutter.gatewayPort", null)?.trim().orEmpty()
        val token = prefs.getString("flutter.gatewayToken", null)?.trim().orEmpty()
        if (host.isEmpty() || port.isEmpty()) return null
        val cleanHost = host
            .removePrefix("http://")
            .removePrefix("https://")
            .trimEnd('/')
        return GatewayConfig("http://$cleanHost:$port", "ws://$cleanHost:$port", token)
    }

    private fun connect() {
        val config = gatewayConfig()
        if (config == null) {
            stopSelf()
            return
        }
        val uri = Uri.parse("${config.wsBase}/api/session-events")
            .buildUpon()
            .appendQueryParameter("token", config.token)
            .build()
        val client = OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
        val request = Request.Builder().url(uri.toString()).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                backoff = 2000L
                saveWatchStatus("已连接网关，等待会话事件")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleEvent(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "gateway ws error: ${t.message}")
                saveWatchStatus("连接失败：${t.message ?: response?.code ?: ""}")
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!running) return
        Handler(mainLooper).postDelayed({
            if (running) connect()
        }, backoff)
        backoff = (backoff * 2).coerceAtMost(60000)
    }

    private fun handleEvent(text: String) {
        try {
            val event = JSONObject(text)
            if (event.optString("type") != "session_task_state_changed") return
            val taskState = event.optString("taskState")
            if (taskState != "needs_confirmation" && taskState != "completed") return
            val session = event.optJSONObject("session") ?: return
            val sessionId = session.optString("id")
            val name = session.optString("name").ifBlank { sessionId }
            val needsReview = taskState == "needs_confirmation"
            val title = if (needsReview) "会话:$name 需要审核" else "会话:$name 已停止"
            saveWatchStatus("收到事件：$title；悬浮窗权限=${hasOverlayPermissionNow()}")
            postAlert(title, sessionId)
        } catch (_: Exception) {
        }
    }

    private fun hasOverlayPermissionNow(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            android.provider.Settings.canDrawOverlays(this)

    private fun saveWatchStatus(value: String) {
        getSharedPreferences("gateway_watch_status", Context.MODE_PRIVATE)
            .edit()
            .putString("status", value)
            .putLong("at", System.currentTimeMillis())
            .apply()
    }

    private fun postAlert(message: String, sessionId: String) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("fuluk://session/$sessionId")
            setClass(this@GatewayWatchService, MainActivity::class.java)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val pending = PendingIntent.getActivity(this, sessionId.hashCode(), intent, pendingFlags)
        val notification = Notification.Builder(this, CHANNEL_ALERT)
            .setContentTitle("Fuluk")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .setPriority(Notification.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVibrate(longArrayOf(0, 400, 200, 400, 200, 600))
            .setContentIntent(pending)
            .build()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(sessionId.hashCode(), notification)
        val needsReview = message.contains("需要审核")
        if (needsReview && sessionId != "__test__") {
            Thread {
                var contextText = ""
                try {
                    val config = gatewayConfig()
                    if (config != null) {
                        val prompt = JSONObject(
                            httpJson(
                                "${config.httpBase}/api/sessions/$sessionId/prompt?lines=80",
                                config.token, "GET", null
                            )
                        )
                        if (prompt.optBoolean("needsConfirmation")) {
                            contextText = prompt.optString("context")
                        }
                    }
                } catch (_: Exception) {}
                val finalContext = contextText
                Handler(mainLooper).post { showOverlay(message, sessionId, finalContext) }
            }.start()
        } else {
            Handler(mainLooper).post { showOverlay(message, sessionId, "") }
        }
    }

    private fun showOverlay(message: String, sessionId: String, contextText: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            !android.provider.Settings.canDrawOverlays(this)
        ) return
        removeOverlay(sessionId)
        val needsReview = message.contains("需要审核")

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xEE101010.toInt())
            setPadding(24, 20, 24, 20)
        }
        val messageView = TextView(this).apply {
            text = message
            setTextColor(Color.WHITE)
            textSize = 15f
            setPadding(0, 0, 0, 14)
        }
        val contextView = TextView(this).apply {
            text = contextText
            setTextColor(0xFFB0BEC5.toInt())
            textSize = 11f
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(0, 0, 0, 14)
            maxHeight = (220 * resources.displayMetrics.density).toInt()
            isVerticalScrollBarEnabled = true
            movementMethod = android.text.method.ScrollingMovementMethod.getInstance()
            visibility = if (contextText.isBlank()) android.view.View.GONE else android.view.View.VISIBLE
        }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }

        fun makeButton(label: String, primary: Boolean): Button =
            Button(this).apply {
                text = label
                if (primary) setBackgroundColor(0xFF2E7D32.toInt())
                setTextColor(Color.WHITE)
                val params = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                params.setMargins(0, 0, 12, 0)
                layoutParams = params
            }

        container.addView(messageView)
        container.addView(contextView)
        if (needsReview) {
            val approve = makeButton("同意", true)
            val reject = makeButton("拒绝", false)
            approve.setOnClickListener { resolveFromOverlay(sessionId, true) }
            reject.setOnClickListener { resolveFromOverlay(sessionId, false) }
            row.addView(approve)
            row.addView(reject)
        } else {
            val open = makeButton("打开", true)
            open.setOnClickListener {
                dismissAlertFromOverlay(sessionId, true)
            }
            row.addView(open)
        }
        val close = Button(this).apply {
            text = "关闭"
            setTextColor(Color.WHITE)
            setOnClickListener {
                if (needsReview) removeOverlay(sessionId)
                else dismissAlertFromOverlay(sessionId, false)
            }
        }
        row.addView(close)
        container.addView(row)

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP }
        (getSystemService(Context.WINDOW_SERVICE) as WindowManager)
            .addView(container, params)
        overlays[sessionId] = container
    }

    private fun removeOverlay(sessionId: String) {
        val view = overlays.remove(sessionId) ?: return
        try {
            (getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(view)
        } catch (_: Exception) {}
    }

    private fun openSessionIntent(sessionId: String): Intent =
        Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("fuluk://session/$sessionId")
            setClass(this@GatewayWatchService, MainActivity::class.java)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

    private fun dismissAlertFromOverlay(sessionId: String, openApp: Boolean) {
        Thread {
            try {
                val config = gatewayConfig() ?: throw IllegalStateException("gateway not configured")
                httpJson(
                    "${config.httpBase}/api/sessions/$sessionId/dismiss-alert",
                    config.token, "POST", JSONObject().toString()
                )
            } catch (error: Exception) {
                Log.w(TAG, "dismiss alert failed: ${error.message}")
            }
            Handler(mainLooper).post {
                if (openApp) startActivity(openSessionIntent(sessionId))
                removeOverlay(sessionId)
            }
        }.start()
    }

    private fun resolveFromOverlay(sessionId: String, approve: Boolean) {
        Thread {
            try {
                val config = gatewayConfig() ?: throw IllegalStateException("gateway not configured")
                val promptJson = httpJson(
                    "${config.httpBase}/api/sessions/$sessionId/prompt?lines=80",
                    config.token, "GET", null
                )
                val prompt = JSONObject(promptJson)
                if (!prompt.optBoolean("needsConfirmation")) return@Thread
                val choice = prompt.getJSONObject("choices")
                    .getJSONObject(if (approve) "approve" else "reject")
                val send = choice.getString("send")
                val body = when (send) {
                    "keys" -> JSONObject().put("keys", choice.getJSONArray("keys")).toString()
                    else -> JSONObject().put("text", choice.getString("value")).toString()
                }
                httpJson(
                    "${config.httpBase}/api/sessions/$sessionId/$send",
                    config.token, "POST", body
                )
                Handler(mainLooper).post { removeOverlay(sessionId) }
            } catch (error: Exception) {
                Log.w(TAG, "overlay resolve failed: ${error.message}")
                Handler(mainLooper).post {
                    startActivity(openSessionIntent(sessionId))
                    removeOverlay(sessionId)
                }
            }
        }.start()
    }

    private fun httpJson(urlValue: String, token: String, method: String, body: String?): String {
        val connection = URL(urlValue).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15000
        connection.readTimeout = 20000
        if (token.isNotBlank()) connection.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
        }
        val stream = if (connection.responseCode in 200..299) connection.inputStream
        else connection.errorStream
        return stream.bufferedReader().use { it.readText() }
    }

    private fun createChannels() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val listen = NotificationChannel(
            CHANNEL_LISTEN, "监听状态", NotificationManager.IMPORTANCE_MIN
        ).apply { setShowBadge(false) }
        val alert = NotificationChannel(
            CHANNEL_ALERT, "会话提醒", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
        }
        manager.createNotificationChannel(listen)
        manager.createNotificationChannel(alert)
    }

    private fun buildListenNotification(): Notification =
        Notification.Builder(this, CHANNEL_LISTEN)
            .setContentTitle("Fuluk 正在监听")
            .setContentText("等待会话事件")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setOngoing(true)
            .build()

    override fun onDestroy() {
        running = false
        webSocket?.close(1000, null)
        overlays.keys.toList().forEach { removeOverlay(it) }
        super.onDestroy()
    }

    private data class GatewayConfig(val httpBase: String, val wsBase: String, val token: String)

    companion object {
        const val TAG = "GatewayWatch"
        const val ACTION_STOP = "com.fuluk.fuluk_app.STOP_WATCH"
        const val ACTION_TEST_OVERLAY = "com.fuluk.fuluk_app.TEST_OVERLAY"
        const val CHANNEL_LISTEN = "fuluk_listen"
        const val CHANNEL_ALERT = "fuluk_alert"
        const val NOTIFY_LISTEN = 1001
    }
}
