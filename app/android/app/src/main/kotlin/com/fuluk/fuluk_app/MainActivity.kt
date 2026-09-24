package com.fuluk.fuluk_app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    private val channelName = "fuluk/ntfy"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "start" -> {
                        val server = call.argument<String>("server") ?: ""
                        val topic = call.argument<String>("topic") ?: ""
                        val token = call.argument<String>("token") ?: ""
                        if (server.isBlank() || topic.isBlank()) {
                            result.error("bad_config", "server/topic required", null)
                            return@setMethodCallHandler
                        }
                        getSharedPreferences("ntfy_prefs", Context.MODE_PRIVATE)
                            .edit()
                            .putString("server", server.trimEnd('/'))
                            .putString("topic", topic.trim('/'))
                            .putString("token", token)
                            .apply()
                        ensurePermissionThenStart()
                        result.success(true)
                    }
                    "stop" -> {
                        val intent = Intent(this, NtfyService::class.java)
                            .setAction(NtfyService.ACTION_STOP)
                        startService(intent)
                        result.success(true)
                    }
                    "hasPermission" -> result.success(hasNotificationPermission())
                    "requestPermission" -> {
                        requestNotificationPermission()
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasNotificationPermission()) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2001)
        }
    }

    private fun ensurePermissionThenStart() {
        requestNotificationPermission()
        val intent = Intent(this, NtfyService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }
}
