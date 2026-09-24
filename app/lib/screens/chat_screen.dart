import 'package:flutter/material.dart';
import 'dart:async';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../api.dart';
import '../config.dart';
import '../history_store.dart';

class ChatMessage {
  final bool fromUser;
  final String text;

  ChatMessage({required this.fromUser, required this.text});
}

String stripAnsi(String text) =>
    text.replaceAll(RegExp(r"\x1b\[[0-?]*[ -/]*[@-~]"), "");

class ChatScreen extends StatefulWidget {
  final AppConfig config;
  final SessionInfo session;

  const ChatScreen({super.key, required this.config, required this.session});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  late final GatewayClient _client;
  final List<ChatMessage> _assistantMessages = [];
  final TextEditingController _input = TextEditingController();
  final ScrollController _terminalScroll = ScrollController();
  final AudioRecorder _recorder = AudioRecorder();
  bool _recording = false;
  bool _busy = false;
  bool _loadingTerminal = true;
  bool _followOutput = true;
  String _terminalText = "";
  PromptInfo? _prompt;
  String? _lastSignature;
  Timer? _terminalTimer;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _client = GatewayClient(widget.config);
    _loadAssistantHistory();
    _refreshTerminal();
    _pollPrompt();
    _terminalTimer =
        Timer.periodic(const Duration(seconds: 2), (_) => _refreshTerminal());
  }

  @override
  void dispose() {
    _tabs.dispose();
    _terminalTimer?.cancel();
    _input.dispose();
    _terminalScroll.dispose();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _loadAssistantHistory() async {
    final stored = await HistoryStore.load(widget.session.id);
    setState(() => _assistantMessages.addAll(stored[1]));
  }

  Future<void> _persistAssistant() =>
      HistoryStore.save(widget.session.id, const [], _assistantMessages);

  Future<void> _refreshTerminal() async {
    try {
      final output =
          stripAnsi(await _client.fetchOutput(widget.session.id, 300));
      if (!mounted) return;
      setState(() {
        _terminalText = output;
        _loadingTerminal = false;
      });
      _scrollToBottom();
    } catch (_) {
      if (mounted) setState(() => _loadingTerminal = false);
    }
  }

  Future<void> _pollPrompt() async {
    while (mounted) {
      try {
        final prompt = await _client.fetchPrompt(widget.session.id);
        final signature = prompt?.context;
        if (!mounted) return;
        if (signature != _lastSignature) {
          setState(() {
            _prompt = prompt;
            _lastSignature = signature;
          });
        }
      } catch (_) {}
      await Future.delayed(const Duration(seconds: 4));
    }
  }

  Future<void> _resolveFromBanner(bool approve) async {
    final prompt = _prompt;
    if (prompt == null) return;
    setState(() => _busy = true);
    try {
      await _client.resolvePrompt(
          widget.session.id, approve ? prompt.approve : prompt.reject);
      setState(() {
        _prompt = null;
        _lastSignature = null;
      });
      await Future.delayed(const Duration(seconds: 2));
      await _refreshTerminal();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text("$error"), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _busy) return;
    final toAssistant = _tabs.index == 1;
    setState(() {
      _busy = true;
      _input.clear();
    });
    try {
      if (toAssistant) {
        final answer = await _client.askAssistant(text, widget.session.id);
        setState(() {
          _assistantMessages.add(ChatMessage(fromUser: true, text: text));
          _assistantMessages.add(ChatMessage(fromUser: false, text: answer));
        });
        await _persistAssistant();
      } else {
        _followOutput = true;
        await _client.sendInput(widget.session.id, text);
        await Future.delayed(const Duration(milliseconds: 800));
        await _refreshTerminal();
      }
    } catch (error) {
      if (toAssistant) {
        setState(() => _assistantMessages
            .add(ChatMessage(fromUser: false, text: "错误：$error")));
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text("$error"), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleRecording() async {
    if (!widget.config.asrConfigured) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text("请先在设置中配置 ASR API")));
      return;
    }
    if (_recording) {
      final path = await _recorder.stop();
      setState(() {
        _recording = false;
        _busy = true;
      });
      try {
        if (path != null) {
          final raw = await transcribeAudio(widget.config, path);
          _input.text = widget.config.polishConfigured
              ? await polishTranscript(widget.config, raw)
              : raw;
        }
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text("$error")));
        }
      } finally {
        if (mounted) setState(() => _busy = false);
      }
      return;
    }

    if (!await _recorder.hasPermission()) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text("需要麦克风权限")));
      }
      return;
    }
    final tempDir = await getTemporaryDirectory();
    final path =
        "${tempDir.path}/voice_${DateTime.now().millisecondsSinceEpoch}.m4a";
    await _recorder.start(const RecordConfig(), path: path);
    setState(() => _recording = true);
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_terminalScroll.hasClients || !_followOutput) return;
      _terminalScroll.jumpTo(_terminalScroll.position.maxScrollExtent);
    });
  }

  bool _nearBottom() {
    if (!_terminalScroll.hasClients) return true;
    return _terminalScroll.position.maxScrollExtent - _terminalScroll.offset <
        80;
  }

  Widget _terminalView() {
    if (_loadingTerminal) {
      return const Center(child: CircularProgressIndicator());
    }
    return NotificationListener<ScrollNotification>(
        onNotification: (notification) {
          if (notification is ScrollUpdateNotification) {
            _followOutput = _nearBottom();
          }
          return false;
        },
        child: Container(
            color: Colors.black,
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            child: SingleChildScrollView(
                controller: _terminalScroll,
                child: SelectableText(
                    _terminalText.isEmpty ? "暂无输出" : _terminalText,
                    style: const TextStyle(
                        color: Color(0xFFD6E2EA),
                        fontSize: 12,
                        height: 1.25,
                        fontFamily: "monospace",
                        fontFamilyFallback: [
                          "Menlo",
                          "Consolas",
                          "Courier New"
                        ])))));
  }

  Widget _assistantView() {
    if (_assistantMessages.isEmpty) {
      return const Center(
          child: Text("暂无助手对话，说点什么", style: TextStyle(color: Colors.grey)));
    }
    return ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _assistantMessages.length,
        itemBuilder: (context, index) {
          final message = _assistantMessages[index];
          return Align(
              alignment: message.fromUser
                  ? Alignment.centerRight
                  : Alignment.centerLeft,
              child: Container(
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  constraints: BoxConstraints(
                      maxWidth: MediaQuery.of(context).size.width * 0.78),
                  decoration: BoxDecoration(
                      color: message.fromUser
                          ? Theme.of(context).colorScheme.primaryContainer
                          : Theme.of(context)
                              .colorScheme
                              .surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(12)),
                  child: SelectableText(message.text)));
        });
  }

  Widget _pendingBanner() {
    final prompt = _prompt;
    return Material(
        color: Colors.red.shade700,
        child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Row(children: [
                const Icon(Icons.gpp_maybe, color: Colors.white, size: 26),
                const SizedBox(width: 8),
                const Expanded(
                    child: Text("该会话正在等待确认！",
                        style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 16))),
                IconButton(
                    tooltip: "查看上下文",
                    onPressed: () {
                      showDialog(
                          context: context,
                          builder: (context) => AlertDialog(
                                  title: const Text("待确认上下文"),
                                  content: SingleChildScrollView(
                                      child: Text(prompt?.context ?? "")),
                                  actions: [
                                    TextButton(
                                        onPressed: () => Navigator.pop(context),
                                        child: const Text("关闭"))
                                  ]));
                    },
                    icon: const Icon(Icons.info_outline, color: Colors.white))
              ]),
              if (prompt != null)
                Row(children: [
                  Expanded(
                      child: FilledButton.icon(
                          style: FilledButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: Colors.red.shade800,
                              minimumSize: const Size.fromHeight(48)),
                          onPressed:
                              _busy ? null : () => _resolveFromBanner(false),
                          icon: const Icon(Icons.close),
                          label: const Text("拒绝",
                              style: TextStyle(
                                  fontSize: 17, fontWeight: FontWeight.bold)))),
                  const SizedBox(width: 12),
                  Expanded(
                      child: FilledButton.icon(
                          style: FilledButton.styleFrom(
                              backgroundColor: Colors.green,
                              foregroundColor: Colors.white,
                              minimumSize: const Size.fromHeight(48)),
                          onPressed:
                              _busy ? null : () => _resolveFromBanner(true),
                          icon: const Icon(Icons.check),
                          label: const Text("同意",
                              style: TextStyle(
                                  fontSize: 17, fontWeight: FontWeight.bold))))
                ])
            ])));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
        appBar: AppBar(
            title: Text(widget.session.name),
            bottom: TabBar(
                controller: _tabs,
                tabs: const [Tab(text: "会话 TUI"), Tab(text: "对助手说")])),
        body: Column(children: [
          if (_prompt != null) _pendingBanner(),
          Expanded(
              child: TabBarView(
                  controller: _tabs,
                  children: [_terminalView(), _assistantView()])),
          if (_busy) const LinearProgressIndicator(),
          SafeArea(
              child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                            style: FilledButton.styleFrom(
                                backgroundColor:
                                    _recording ? Colors.red : Colors.blueGrey,
                                minimumSize: const Size.fromHeight(56)),
                            onPressed: _busy ? null : _toggleRecording,
                            icon: Icon(_recording ? Icons.stop : Icons.mic,
                                size: 28),
                            label: Text(_recording ? "停止录音" : "按住说话 / 点击录音",
                                style: const TextStyle(fontSize: 17)))),
                    const SizedBox(height: 8),
                    Row(children: [
                      Expanded(
                          child: TextField(
                              controller: _input,
                              minLines: 1,
                              maxLines: 4,
                              decoration: const InputDecoration(
                                  hintText: "输入消息，或确认语音结果",
                                  border: OutlineInputBorder()),
                              onSubmitted: (_) => _send())),
                      IconButton(
                          onPressed: _busy ? null : _send,
                          icon: const Icon(Icons.send, size: 26),
                          color: Theme.of(context).colorScheme.primary)
                    ])
                  ])))
        ]));
  }
}
