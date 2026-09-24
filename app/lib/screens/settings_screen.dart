import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../api.dart';
import '../config.dart';
import '../ntfy_service.dart';

class SettingsScreen extends StatefulWidget {
  final AppConfig config;
  final VoidCallback onSaved;

  const SettingsScreen(
      {super.key, required this.config, required this.onSaved});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _gatewayHost;
  late final TextEditingController _gatewayPort;
  late final TextEditingController _gatewayToken;
  late final TextEditingController _ntfyServer;
  late final TextEditingController _ntfyTopic;
  late final TextEditingController _ntfyToken;
  late final TextEditingController _asrBaseUrl;
  late final TextEditingController _asrModel;
  late final TextEditingController _asrApiKey;
  late final TextEditingController _polishBaseUrl;
  late final TextEditingController _polishModel;
  late final TextEditingController _polishApiKey;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final c = widget.config;
    _gatewayHost = TextEditingController(text: c.gatewayHost);
    _gatewayPort = TextEditingController(text: c.gatewayPort);
    _gatewayToken = TextEditingController(text: c.gatewayToken);
    _ntfyServer = TextEditingController(text: c.ntfyServer);
    _ntfyTopic = TextEditingController(text: c.ntfyTopic);
    _ntfyToken = TextEditingController(text: c.ntfyToken);
    _asrBaseUrl = TextEditingController(text: c.asrBaseUrl);
    _asrModel = TextEditingController(text: c.asrModel);
    _asrApiKey = TextEditingController(text: c.asrApiKey);
    _polishBaseUrl = TextEditingController(text: c.polishBaseUrl);
    _polishModel = TextEditingController(text: c.polishModel);
    _polishApiKey = TextEditingController(text: c.polishApiKey);
  }

  void _syncToConfig() {
    final c = widget.config;
    c.gatewayHost = _gatewayHost.text;
    c.gatewayPort = _gatewayPort.text;
    c.gatewayToken = _gatewayToken.text;
    c.ntfyServer = _ntfyServer.text;
    c.ntfyTopic = _ntfyTopic.text;
    c.ntfyToken = _ntfyToken.text;
    c.asrBaseUrl = _asrBaseUrl.text;
    c.asrModel = _asrModel.text;
    c.asrApiKey = _asrApiKey.text;
    c.polishBaseUrl = _polishBaseUrl.text;
    c.polishModel = _polishModel.text;
    c.polishApiKey = _polishApiKey.text;
  }

  Future<void> _runTest(String label, Future<void> Function() task) async {
    setState(() => _busy = true);
    _syncToConfig();
    try {
      await task();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text("$label 成功"), backgroundColor: Colors.green));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text("$label 失败：$error"), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _testNtfy() async {
    final c = widget.config;
    if (!c.ntfyConfigured) throw Exception("请填写 ntfy 服务器和 Topic");
    final server = c.ntfyServer.trim().replaceAll(RegExp(r"/+$"), "");
    final topic = Uri.encodeComponent(c.ntfyTopic.trim());
    final uri = Uri.parse("$server/$topic").replace(queryParameters: {
      "title": "Fuluk 测试通知"
    });
    final headers = <String, String>{};
    if (c.ntfyToken.trim().isNotEmpty) {
      headers["authorization"] =
          c.ntfyToken.startsWith("Bearer ") || c.ntfyToken.startsWith("Basic ")
              ? c.ntfyToken.trim()
              : "Bearer ${c.ntfyToken.trim()}";
    }
    final response =
        await http.post(uri, headers: headers, body: "如果你看到这条消息，ntfy 通知配置正常。");
    if (response.statusCode != 200) {
      throw Exception("HTTP ${response.statusCode}");
    }
  }

  Future<void> _save() async {
    _syncToConfig();
    await widget.config.save();
    if (widget.config.ntfyConfigured) {
      await GatewayClient(widget.config).configureNtfy();
    }
    await NtfyService.applyConfig(widget.config);
    widget.onSaved();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
        appBar: AppBar(title: const Text("设置")),
        body: AbsorbPointer(
            absorbing: _busy,
            child: ListView(padding: const EdgeInsets.all(16), children: [
              const _SectionTitle("Fuluk 网关"),
              TextField(
                  controller: _gatewayHost,
                  decoration: const InputDecoration(
                      labelText: "服务器地址",
                      hintText: "192.168.1.10 或 http://192.168.1.10"),
                  keyboardType: TextInputType.url),
              TextField(
                  controller: _gatewayPort,
                  decoration: const InputDecoration(labelText: "端口"),
                  keyboardType: TextInputType.number),
              TextField(
                  controller: _gatewayToken,
                  decoration: const InputDecoration(labelText: "Token"),
                  obscureText: true),
              Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                      onPressed: () => _runTest("连接", () async {
                            if (!widget.config.gatewayConfigured) {
                              throw Exception("请完整填写网关配置");
                            }
                            await GatewayClient(widget.config).checkHealth();
                          }),
                      icon: const Icon(Icons.wifi_find),
                      label: const Text("测试连接"))),
              const Divider(height: 32),
              const _SectionTitle("ntfy 通知"),
              TextField(
                  controller: _ntfyServer,
                  decoration: const InputDecoration(
                      labelText: "ntfy 服务器", hintText: "https://ntfy.sh"),
                  keyboardType: TextInputType.url),
              TextField(
                  controller: _ntfyTopic,
                  decoration: const InputDecoration(labelText: "Topic")),
              TextField(
                  controller: _ntfyToken,
                  decoration: const InputDecoration(labelText: "访问 Token（可选）")),
              Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                      onPressed: () => _runTest("通知", _testNtfy),
                      icon: const Icon(Icons.notifications_active_outlined),
                      label: const Text("发送测试通知"))),
              const Divider(height: 32),
              const _SectionTitle("语音转写"),
              TextField(
                  controller: _asrBaseUrl,
                  decoration: const InputDecoration(
                      labelText: "ASR API 地址",
                      hintText: "http://192.168.1.10:8003"),
                  keyboardType: TextInputType.url),
              TextField(
                  controller: _asrModel,
                  decoration: const InputDecoration(labelText: "模型名")),
              TextField(
                  controller: _asrApiKey,
                  decoration: const InputDecoration(labelText: "API Key（可选）"),
                  obscureText: true),
              const Divider(height: 32),
              const _SectionTitle("语音润色 LLM"),
              TextField(
                  controller: _polishBaseUrl,
                  decoration: const InputDecoration(
                      labelText: "LLM API 地址",
                      hintText: "http://192.168.1.10:8000"),
                  keyboardType: TextInputType.url),
              TextField(
                  controller: _polishModel,
                  decoration: const InputDecoration(
                      labelText: "模型名",
                      hintText: "识别结果将交给该模型勘错润色")),
              TextField(
                  controller: _polishApiKey,
                  decoration: const InputDecoration(labelText: "API Key（可选）"),
                  obscureText: true),
              const SizedBox(height: 24),
              FilledButton.icon(
                  onPressed: _busy ? null : _save,
                  icon: const Icon(Icons.save),
                  label: const Text("保存"))
            ])));
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;

  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
        padding: const EdgeInsets.only(bottom: 8, top: 4),
        child: Text(text,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)));
  }
}
