package com.fuluk.fuluk_app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    private val channelName = "fuluk/gateway-watch"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "start" -> {
                        ensurePermissionThenStart()
                        result.success(true)
                    }
                    "stop" -> {
                        val intent = Intent(this, GatewayWatchService::class.java)
                            .setAction(GatewayWatchService.ACTION_STOP)
                        startService(intent)
                        result.success(true)
                    }
                    "hasPermission" -> result.success(hasNotificationPermission())
                    "requestPermission" -> {
                        requestNotificationPermission()
                        result.success(true)
                    }
                    "hasOverlayPermission" -> result.success(canDrawOverlays())
                    "requestOverlayPermission" -> {
                        requestOverlayPermission()
                        result.success(true)
                    }
                    "testOverlay" -> {
                        startService(
                            Intent(this, GatewayWatchService::class.java)
                                .setAction(GatewayWatchService.ACTION_TEST_OVERLAY)
                        )
                        result.success(canDrawOverlays())
                    }
                    "watchStatus" -> {
                        val s = getSharedPreferences("gateway_watch_status", Context.MODE_PRIVATE)
                        result.success(s.getString("status", "") ?: "")
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
        val intent = Intent(this, GatewayWatchService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun canDrawOverlays(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)

    private fun requestOverlayPermission() {
        if (canDrawOverlays()) return
        startActivity(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
        )
    }
}
