package com.fuluk.fuluk_app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class NtfyService : Service() {

    private var running = false
    private var thread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            else -> start()
        }
        return START_STICKY
    }

    private fun prefs() =
        getSharedPreferences("ntfy_prefs", Context.MODE_PRIVATE)

    private fun start() {
        if (running) return
        createChannels()
        startForeground(NOTIFY_LISTEN, buildListenNotification())
        running = true
        thread = Thread { loop() }.also { it.start() }
    }

    private fun loop() {
        var backoff = 2000L
        while (running) {
            var connection: HttpURLConnection? = null
            try {
                val p = prefs()
                val server = p.getString("server", "")!!.trimEnd('/')
                val topic = p.getString("topic", "")!!.trim('/')
                val token = p.getString("token", "") ?: ""
                if (server.isEmpty() || topic.isEmpty()) {
                    stopSelf()
                    return
                }
                val url = URL("$server/$topic/json")
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 20000
                    readTimeout = 0
                    setRequestProperty("Accept", "application/x-ndjson")
                    if (token.isNotBlank()) {
                        setRequestProperty(
                            "Authorization",
                            if (token.startsWith("Bearer ") || token.startsWith("Basic ")) token
                            else "Bearer $token"
                        )
                    }
                }
                connection.connect()
                val code = connection.responseCode
                if (code != 200) throw RuntimeException("HTTP $code")
                backoff = 2000L
                val reader = BufferedReader(InputStreamReader(connection.inputStream, "UTF-8"))
                var line: String? = null
                while (running && reader.readLine().also { line = it } != null) {
                    handleLine(line ?: continue)
                }
            } catch (error: Exception) {
                Log.w(TAG, "ntfy stream error: ${error.message}")
            } finally {
                connection?.disconnect()
            }
            if (running) {
                try { Thread.sleep(backoff) } catch (_: InterruptedException) {}
                backoff = (backoff * 2).coerceAtMost(60000)
            }
        }
    }

    private fun handleLine(line: String) {
        if (line.isBlank()) return
        try {
            val json = JSONObject(line)
            if (json.optString("event", "message") != "message") return
            val title = json.optString("title").ifBlank { "Fuluk 通知" }
            val message = json.optString("message")
            val sessionId = extractSessionId(json.optString("click"))
                ?: json.optString("topic")
            postAlert(title, message, sessionId)
        } catch (_: Exception) {
        }
    }

    private fun extractSessionId(click: String): String? {
        if (click.isBlank()) return null
        return try {
            val uri = Uri.parse(click)
            if (uri.scheme == "fuluk" && uri.host == "session" && uri.pathSegments.isNotEmpty())
                uri.pathSegments[0]
            else null
        } catch (_: Exception) { null }
    }

    private fun postAlert(title: String, message: String, sessionId: String) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("fuluk://session/$sessionId")
            setClass(this@NtfyService, MainActivity::class.java)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val pending = PendingIntent.getActivity(this, sessionId.hashCode(), intent, flags)
        val notification = Notification.Builder(this, CHANNEL_ALERT)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(Notification.BigTextStyle().bigText(message))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .setPriority(Notification.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVibrate(longArrayOf(0, 400, 200, 400, 200, 600))
            .setContentIntent(pending)
            .build()
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(sessionId.hashCode(), notification)
    }

    private fun createChannels() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val listen = NotificationChannel(
            CHANNEL_LISTEN, "监听状态", NotificationManager.IMPORTANCE_MIN
        ).apply {
            description = "Fuluk 后台监听通知"
            setShowBadge(false)
        }
        val alert = NotificationChannel(
            CHANNEL_ALERT, "会话提醒", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "会话完成或需要确认"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
            enableLights(true)
            lightColor = 0xFFFF0000.toInt()
        }
        manager.createNotificationChannel(listen)
        manager.createNotificationChannel(alert)
    }

    private fun buildListenNotification(): Notification {
        return Notification.Builder(this, CHANNEL_LISTEN)
            .setContentTitle("Fuluk 正在监听")
            .setContentText("等待会话通知")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        running = false
        thread?.interrupt()
        super.onDestroy()
    }

    companion object {
        const val TAG = "NtfyService"
        const val ACTION_STOP = "com.fuluk.fuluk_app.STOP"
        const val CHANNEL_LISTEN = "fuluk_listen"
        const val CHANNEL_ALERT = "fuluk_alert"
        const val NOTIFY_LISTEN = 1001
    }
}
