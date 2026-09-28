import 'package:flutter/services.dart';

class GatewayWatch {
  static const _channel = MethodChannel("fuluk/gateway-watch");

  static Future<void> start() => _channel.invokeMethod("start");

  static Future<void> stop() => _channel.invokeMethod("stop");

  static Future<bool> hasOverlayPermission() async =>
      await _channel.invokeMethod("hasOverlayPermission") as bool;

  static Future<void> requestOverlayPermission() =>
      _channel.invokeMethod("requestOverlayPermission");

  static Future<void> testOverlay() => _channel.invokeMethod("testOverlay");

  static Future<String> watchStatus() async =>
      await _channel.invokeMethod("watchStatus") as String;
}
