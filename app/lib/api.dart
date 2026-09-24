import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';

class SessionInfo {
  final String id;
  final String name;
  final String kind;
  final String status;
  final String? taskState;
  final String? project;
  final String? phase;

  SessionInfo(
      {required this.id,
      required this.name,
      required this.kind,
      required this.status,
      required this.taskState,
      required this.project,
      required this.phase});

  factory SessionInfo.fromJson(Map<String, dynamic> json) {
    return SessionInfo(
        id: json["id"] as String,
        name: (json["name"] as String?) ?? json["id"] as String,
        kind: (json["kind"] as String?) ?? "",
        status: (json["status"] as String?) ?? "",
        taskState: json["taskState"] as String?,
        project: json["project"] as String?,
        phase: json["phase"] as String?);
  }
}

class PromptChoice {
  final String send;
  final String? value;
  final List<String>? keys;

  PromptChoice({required this.send, this.value, this.keys});

  factory PromptChoice.fromJson(Map<String, dynamic> json) {
    return PromptChoice(
        send: json["send"] as String,
        value: json["value"] as String?,
        keys:
            (json["keys"] as List<dynamic>?)?.map((e) => e as String).toList());
  }

  Map<String, dynamic> toRequest() {
    if (send == "keys") return {"keys": keys};
    return {"text": value};
  }
}

class PromptInfo {
  final String context;
  final PromptChoice approve;
  final PromptChoice reject;

  PromptInfo(
      {required this.context, required this.approve, required this.reject});

  factory PromptInfo.fromJson(Map<String, dynamic> json) {
    return PromptInfo(
        context: json["context"] as String? ?? "",
        approve: PromptChoice.fromJson(
            json["choices"]["approve"] as Map<String, dynamic>),
        reject: PromptChoice.fromJson(
            json["choices"]["reject"] as Map<String, dynamic>));
  }
}

class GatewayClient {
  final AppConfig config;

  GatewayClient(this.config);

  Map<String, String> get _headers => {
        "content-type": "application/json",
        "authorization": "Bearer ${config.gatewayToken}"
      };

  Uri _uri(String path, [Map<String, String>? query]) {
    return Uri.parse("${config.gatewayBaseUrl}$path")
        .replace(queryParameters: query);
  }

  Future<void> checkHealth() async {
    final response = await http.get(_uri("/health"));
    if (response.statusCode != 200) {
      throw Exception("服务异常 (${response.statusCode})");
    }
  }

  Future<List<SessionInfo>> listSessions() async {
    final response = await http.get(_uri("/api/sessions"), headers: _headers);
    if (response.statusCode != 200) {
      throw Exception("获取会话失败 (${response.statusCode})");
    }
    final body =
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    final sessions = body["sessions"] as List<dynamic>;
    return sessions
        .map((e) => SessionInfo.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<SessionInfo> createSession({
    required String kind,
    required String name,
    String project = "",
    String cwd = "",
  }) async {
    final response = await http.post(
      _uri("/api/sessions"),
      headers: _headers,
      body: jsonEncode({
        "kind": kind,
        if (name.trim().isNotEmpty) "name": name.trim(),
        if (project.trim().isNotEmpty) "project": project.trim(),
        if (cwd.trim().isNotEmpty) "cwd": cwd.trim(),
      }),
    );
    if (response.statusCode != 200 && response.statusCode != 201) {
      throw Exception("创建会话失败 (${response.statusCode})");
    }
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return SessionInfo.fromJson(body["session"] as Map<String, dynamic>);
  }

  Future<void> deleteSession(String sessionId) async {
    final response = await http.delete(
      _uri("/api/sessions/$sessionId/delete"),
      headers: _headers,
    );
    if (response.statusCode != 200) {
      throw Exception("删除会话失败 (${response.statusCode})");
    }
  }

  Future<void> stopSession(String sessionId) async {
    final response = await http.delete(
      _uri("/api/sessions/$sessionId"),
      headers: _headers,
    );
    if (response.statusCode != 200) {
      throw Exception("停止会话失败 (${response.statusCode})");
    }
  }

  Future<void> restartSession(String sessionId) async {
    final response = await http.post(
      _uri("/api/sessions/$sessionId/restart"),
      headers: _headers,
    );
    if (response.statusCode != 200) {
      throw Exception("重启会话失败 (${response.statusCode})");
    }
  }

  Future<PromptInfo?> fetchPrompt(String sessionId) async {
    final response = await http.get(
        _uri("/api/sessions/$sessionId/prompt", const {"lines": "80"}),
        headers: _headers);
    if (response.statusCode != 200) {
      throw Exception("获取确认信息失败 (${response.statusCode})");
    }
    final body =
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    if (body["needsConfirmation"] != true) return null;
    return PromptInfo.fromJson(body);
  }

  Future<String> fetchOutput(String sessionId, int lines) async {
    final response = await http.get(
        _uri("/api/sessions/$sessionId/output", {"lines": "$lines"}),
        headers: _headers);
    if (response.statusCode != 200) {
      throw Exception("获取输出失败 (${response.statusCode})");
    }
    return utf8.decode(response.bodyBytes);
  }

  Future<List<String>> fetchInputHistory(String sessionId) async {
    final response = await http.get(
      _uri("/api/sessions/$sessionId/history", const {"limit": "100"}),
      headers: _headers
    );
    if (response.statusCode != 200) return [];
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    final history = body["history"] as List<dynamic>;
    return history.reversed.map((e) => (e["text"] as String?) ?? "").toList();
  }

  Future<void> sendInput(String sessionId, String text) async {
    final response = await http.post(_uri("/api/sessions/$sessionId/input"),
        headers: _headers, body: jsonEncode({"text": text}));
    if (response.statusCode != 200) {
      throw Exception("发送失败 (${response.statusCode})");
    }
  }

  Future<void> resolvePrompt(String sessionId, PromptChoice choice) async {
    final path = choice.send == "keys" ? "keys" : "input";
    final response = await http.post(_uri("/api/sessions/$sessionId/$path"),
        headers: _headers, body: jsonEncode(choice.toRequest()));
    if (response.statusCode != 200) {
      throw Exception("操作失败 (${response.statusCode})");
    }
  }

  Future<String> askAssistant(String text, String currentSessionId) async {
    final response = await http.post(_uri("/api/nl"),
        headers: _headers,
        body: jsonEncode({"text": text, "currentSessionId": currentSessionId}));
    if (response.statusCode != 200 && response.statusCode != 201) {
      throw Exception("助手请求失败 (${response.statusCode})");
    }
    final body =
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return (body["answer"] as String?) ??
        (body["help"] as String?) ??
        (body["message"] as String?) ??
        const JsonEncoder.withIndent("  ").convert(body);
  }

  Future<void> configureNtfy() async {
    final server = config.ntfyServer.trim().replaceAll(RegExp(r"/+$"), "");
    final response = await http.put(_uri("/api/config"),
        headers: _headers,
        body: jsonEncode({
          "settings": {
            "notifications": {
              "ntfy": {
                "server": server,
                "topic": config.ntfyTopic.trim(),
                "token": config.ntfyToken.trim(),
                "enabled": true
              }
            }
          }
        }));
    if (response.statusCode != 200) {
      throw Exception("写入 ntfy 配置失败 (${response.statusCode})");
    }
  }
}

Future<String> transcribeAudio(AppConfig config, String audioPath) async {
  final base = config.asrBaseUrl.trim().replaceAll(RegExp(r"/+$"), "");
  final uri = Uri.parse("$base/v1/audio/transcriptions");
  final request = http.MultipartRequest("POST", uri)
    ..fields["model"] = config.asrModel.trim()
    ..files.add(await http.MultipartFile.fromPath("file", audioPath));
  if (config.asrApiKey.trim().isNotEmpty) {
    request.headers["authorization"] = "Bearer ${config.asrApiKey.trim()}";
  }
  final streamed = await request.send();
  final body = await streamed.stream.bytesToString();
  if (streamed.statusCode != 200) {
    throw Exception("转写失败 (${streamed.statusCode})");
  }
  try {
    final decoded = jsonDecode(body) as Map<String, dynamic>;
    final text = decoded["text"] as String?;
    if (text != null && text.trim().isNotEmpty) return text.trim();
  } catch (_) {
    if (body.trim().isNotEmpty) return body.trim();
  }
  throw Exception("未识别到语音");
}

const polishSystemPrompt =
    "你是Fuluk Gateway手机APP的语音勘错助手。Fuluk用于管理AI编程会话"
    "（Codex、Claude、OpenCode、Pi OS、Runtime），用户语音多为编程指令、"
    "改代码、调试报错和会话管理。\n\n"
    "按产品术语纠错：\n"
    "- “绘画”通常应为“会话”（如查看会话、新建会话、切换会话、会话列表），"
    "除非明确指图片。\n"
    "- “却认”应为“确认”，“同以”应为“同意”，“挺止”应为“停止”，"
    "“重起”应为“重启”，“运形”应为“运行”，“代马”应为“代码”。\n"
    "- 保留术语：会话、会话ID、权限、允许、放行、拒绝、终端、tmux、编译、"
    "构建、提交、分支、仓库、接口、日志、进程。\n\n"
    "要求：修正错字、断句、标点，保持原意和命令语气，不扩写，不补内容。"
    "只输出整理后的文字。";

Future<String> polishTranscript(AppConfig config, String rawText) async {
  final base = config.polishBaseUrl.trim().replaceAll(RegExp(r"/+$"), "");
  final uri = Uri.parse("$base/v1/chat/completions");
  final headers = <String, String>{
    "content-type": "application/json",
  };
  if (config.polishApiKey.trim().isNotEmpty) {
    headers["authorization"] = "Bearer ${config.polishApiKey.trim()}";
  }
  final response = await http.post(
    uri,
    headers: headers,
    body: jsonEncode({
      "model": config.polishModel.trim(),
      "messages": [
        {"role": "system", "content": polishSystemPrompt},
        {"role": "user", "content": rawText}
      ],
      "temperature": 0
    })
  );
  if (response.statusCode != 200) {
    throw Exception("润色失败 (${response.statusCode})");
  }
  final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
  final choices = body["choices"] as List<dynamic>?;
  final content =
      choices?.isNotEmpty == true ? choices![0]["message"]["content"] : null;
  final result = (content as String?)?.trim();
  return (result == null || result.isEmpty) ? rawText : result;
}
