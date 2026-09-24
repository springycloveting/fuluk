import 'package:flutter/services.dart';

import 'config.dart';

class NtfyService {
  static const _channel = MethodChannel("fuluk/ntfy");

  static Future<void> applyConfig(AppConfig config) async {
    if (config.ntfyConfigured) {
      await _channel.invokeMethod("start", {
        "server": config.ntfyServer.trim(),
        "topic": config.ntfyTopic.trim(),
        "token": config.ntfyToken.trim()
      });
    } else {
      await _channel.invokeMethod("stop");
    }
  }

  static Future<void> stop() => _channel.invokeMethod("stop");
}
