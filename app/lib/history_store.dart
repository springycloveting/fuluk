import 'dart:io';

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'screens/chat_screen.dart';

class HistoryStore {
  static Future<List<List<ChatMessage>>> load(String sessionId) async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = _file(dir.path, sessionId);
      if (!await file.exists()) return [[], []];
      final decoded = jsonDecode(await file.readAsString()) as List<dynamic>;
      List<ChatMessage> parse(List<dynamic> items) => items
          .map((e) => ChatMessage(
              fromUser: e["fromUser"] as bool, text: e["text"] as String))
          .toList();
      return [parse(decoded[0] as List<dynamic>), parse(decoded[1] as List<dynamic>)];
    } catch (error) {
      if (kDebugMode) debugPrint("history load failed: $error");
      return [[], []];
    }
  }

  static Future<void> save(
      String sessionId, List<ChatMessage> session, List<ChatMessage> assistant) async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final data = [
        session.map((m) => {"fromUser": m.fromUser, "text": m.text}).toList(),
        assistant.map((m) => {"fromUser": m.fromUser, "text": m.text}).toList()
      ];
      await _file(dir.path, sessionId)
          .writeAsString(jsonEncode(data), flush: true);
    } catch (error) {
      if (kDebugMode) debugPrint("history save failed: $error");
    }
  }

  static _file(String base, String sessionId) {
    return File("$base/history_${sessionId.replaceAll(RegExp(r"[^a-zA-Z0-9_-]"), "_")}.json");
  }
}
