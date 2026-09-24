import 'dart:async';
import 'dart:convert';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../api.dart';
import '../config.dart';
import 'chat_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  final AppConfig config;

  const HomeScreen({super.key, required this.config});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final AppLinks _appLinks = AppLinks();
  late GatewayClient _client;
  List<SessionInfo> _sessions = [];
  final Set<String> _activeSeen = {};
  final List<String> _completedAlerts = [];
  String? _error;
  bool _loading = true;
  final Set<String> _selectedPhases = {"active", "stopped", "closed"};
  static const _allPhases = ["active", "stopped", "closed"];
  WebSocketChannel? _socket;
  StreamSubscription? _socketSub;
  Timer? _reconnectTimer;

  @override
  void initState() {
    super.initState();
    _client = GatewayClient(widget.config);
    _initDeepLinks();
    _refresh();
    _connectSocket();
  }

  @override
  void dispose() {
    _socketSub?.cancel();
    _reconnectTimer?.cancel();
    _socket?.sink.close();
    super.dispose();
  }

  Future<void> _initDeepLinks() async {
    _appLinks.uriLinkStream.listen((uri) {
      if (uri.scheme == "fuluk" && uri.host == "session") {
        final segments = uri.pathSegments;
        final id = segments.isNotEmpty ? segments.first : null;
        if (id != null) _openSessionById(id);
      }
    });
    try {
      final initial = await _appLinks.getInitialLink();
      if (initial != null &&
          initial.scheme == "fuluk" &&
          initial.host == "session" &&
          initial.pathSegments.isNotEmpty) {
        _openSessionById(initial.pathSegments.first);
      }
    } catch (_) {
      // Deep links are optional; ignore if unavailable.
    }
  }

  Future<void> _openSessionById(String id) async {
    await _refresh();
    if (!mounted) return;
    final matches = _sessions.where((s) => s.id == id);
    final session = matches.isEmpty ? null : matches.first;
    if (session != null) _openChat(session);
  }

  void _connectSocket() {
    final base = widget.config.gatewayBaseUrl.replaceFirst("http", "ws");
    final uri = Uri.parse("$base/api/session-events")
        .replace(queryParameters: {"token": widget.config.gatewayToken});
    try {
      final channel = WebSocketChannel.connect(uri);
      _socketSub = channel.stream.listen((data) {
        try {
          final event = jsonDecode(data as String) as Map<String, dynamic>;
          if (event["type"] == "session_task_state_changed") {
            _refresh();
          }
        } catch (_) {}
      }, onError: (_) => _scheduleReconnect(), onDone: _scheduleReconnect);
      _socket = channel;
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _reconnectTimer ??= Timer(const Duration(seconds: 10), () {
      _reconnectTimer = null;
      _connectSocket();
    });
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final sessions = await _client.listSessions();
      for (final session in sessions) {
        if (session.taskState == "in_progress") {
          _activeSeen.add(session.id);
        } else if (session.taskState == "completed" &&
            _activeSeen.remove(session.id) &&
            !_completedAlerts.contains(session.id)) {
          _completedAlerts.add(session.id);
        }
      }
      sessions.sort((a, b) {
        int rank(SessionInfo s) => s.taskState == "needs_confirmation"
            ? 0
            : s.taskState == "in_progress"
                ? 1
                : 2;
        return rank(a).compareTo(rank(b));
      });
      setState(() => _sessions = sessions);
    } catch (error) {
      setState(() => _error = "$error");
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _resolvePrompt(SessionInfo session, bool approve) async {
    try {
      final prompt = await _client.fetchPrompt(session.id);
      if (prompt == null) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text("该会话当前没有待确认的请求")));
        }
        return;
      }
      await _client.resolvePrompt(
          session.id, approve ? prompt.approve : prompt.reject);
      await _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text("$error"), backgroundColor: Colors.red));
      }
    }
  }

  Future<void> _showPromptContext(SessionInfo session) async {
    try {
      final prompt = await _client.fetchPrompt(session.id);
      if (!mounted) return;
      showDialog(
          context: context,
          builder: (context) => AlertDialog(
                  title: Text("需要确认：${session.name}"),
                  content: SingleChildScrollView(
                      child: Text(prompt?.context ?? "未获取到上下文")),
                  actions: [
                    TextButton(
                        onPressed: () {
                          Navigator.pop(context);
                          _resolvePrompt(session, false);
                        },
                        child: const Text("拒绝",
                            style: TextStyle(color: Colors.red))),
                    FilledButton(
                        onPressed: () {
                          Navigator.pop(context);
                          _resolvePrompt(session, true);
                        },
                        child: const Text("同意"))
                  ]));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text("$error"), backgroundColor: Colors.red));
      }
    }
  }

  void _openSettings() {
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => SettingsScreen(
            config: widget.config,
            onSaved: () {
              _client = GatewayClient(widget.config);
              _socketSub?.cancel();
              _socket?.sink.close();
              _connectSocket();
              _refresh();
            })));
  }

  void _openChat(SessionInfo session) {
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ChatScreen(config: widget.config, session: session)));
  }

  Future<void> _showCreateDialog() async {
    final nameController = TextEditingController();
    final projectController = TextEditingController();
    String kind = "codex";

    await showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text("新建会话"),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: kind,
                decoration: const InputDecoration(labelText: "会话类型"),
                items: const [
                  DropdownMenuItem(value: "codex", child: Text("Codex")),
                  DropdownMenuItem(value: "claude", child: Text("Claude")),
                  DropdownMenuItem(value: "opencode", child: Text("OpenCode")),
                  DropdownMenuItem(value: "pi-os", child: Text("Pi OS")),
                  DropdownMenuItem(value: "runtime", child: Text("Runtime")),
                ],
                onChanged: (value) {
                  if (value != null) {
                    kind = value;
                    setDialogState(() {});
                  }
                },
              ),
              TextField(
                controller: nameController,
                decoration: const InputDecoration(
                  labelText: "会话名称",
                  hintText: "可选，留空自动生成",
                ),
              ),
              TextField(
                controller: projectController,
                decoration: const InputDecoration(
                  labelText: "项目标签",
                  hintText: "可选",
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text("取消"),
            ),
            FilledButton(
              onPressed: () async {
                try {
                  final session = await _client.createSession(
                    kind: kind,
                    name: nameController.text,
                    project: projectController.text,
                  );
                  if (!dialogContext.mounted) return;
                  Navigator.pop(dialogContext);
                  await _refresh();
                  _openChat(session);
                } catch (error) {
                  if (!dialogContext.mounted) return;
                  ScaffoldMessenger.of(dialogContext).showSnackBar(
                    SnackBar(
                      content: Text("$error"),
                      backgroundColor: Colors.red,
                    ),
                  );
                }
              },
              child: const Text("创建"),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _runSessionAction(
      SessionInfo session, String label, Future<void> Function() action) async {
    try {
      await action();
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("$label失败：$error"),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  Widget _sessionMenu(SessionInfo session) {
    return PopupMenuButton<String>(
      tooltip: "会话操作",
      onSelected: (value) {
        if (value == "restart") {
          _runSessionAction(session, "重启会话",
              () => _client.restartSession(session.id));
        } else if (value == "stop") {
          _runSessionAction(session, "停止会话",
              () => _client.stopSession(session.id));
        } else if (value == "delete") {
          _confirmDelete(session);
        }
      },
      itemBuilder: (context) => [
        const PopupMenuItem(value: "restart", child: Text("重启会话")),
        if (session.phase != "closed")
          const PopupMenuItem(value: "stop", child: Text("停止会话")),
        const PopupMenuItem(value: "delete", child: Text("删除会话")),
      ],
    );
  }

  Future<void> _confirmDelete(SessionInfo session) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text("删除会话：${session.name}"),
        content: const Text("将会停止会话并删除记录，此操作不可恢复。"),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text("取消"),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(context, true),
            child: const Text("删除"),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await _client.deleteSession(session.id);
        await _refresh();
      } catch (error) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text("$error"),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Icon _stateIcon(SessionInfo session) {
    if (session.taskState == "needs_confirmation") {
      return const Icon(Icons.priority_high, color: Colors.orange);
    }
    if (session.taskState == "completed") {
      return const Icon(Icons.check_circle, color: Colors.green);
    }
    if (session.status != "running") {
      return const Icon(Icons.stop_circle_outlined, color: Colors.grey);
    }
    return const Icon(Icons.autorenew, color: Colors.blue);
  }

  @override
  Widget build(BuildContext context) {
    final pendingCount =
        _sessions.where((s) => s.taskState == "needs_confirmation").length;
    final visibleSessions =
        _sessions.where((s) => _selectedPhases.contains(s.phase)).toList();
    const phaseOptions = [
      ["active", "进行中"],
      ["stopped", "已停止"],
      ["closed", "已关闭"],
    ];
    final allSelected = _selectedPhases.containsAll(_allPhases);
    return Scaffold(
        appBar: AppBar(title: const Text("Fuluk"), actions: [
          IconButton(
              onPressed: _showCreateDialog,
              icon: const Icon(Icons.add_circle_outline)),
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
          IconButton(onPressed: _openSettings, icon: const Icon(Icons.settings))
        ]),
        body: Column(children: [
          if (pendingCount > 0)
            Material(
                color: Colors.red.shade700,
                child: Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Row(children: [
                      const Icon(Icons.gpp_maybe, color: Colors.white, size: 28),
                      const SizedBox(width: 10),
                      Expanded(
                          child: Text(
                              "$pendingCount 个会话等待确认，请立即处理！",
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold))),
                    ]))),
          if (_completedAlerts.isNotEmpty)
            Material(
                color: Colors.green.shade700,
                child: Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Row(children: [
                      const Icon(Icons.check_circle,
                          color: Colors.white, size: 28),
                      const SizedBox(width: 10),
                      Expanded(
                          child: Text(
                              "${_completedAlerts.length} 个会话已完成",
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold))),
                      IconButton(
                          tooltip: "关闭",
                          onPressed: () =>
                              setState(() => _completedAlerts.clear()),
                          icon: const Icon(Icons.close, color: Colors.white)),
                    ]))),
          SizedBox(
              height: 48,
              child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: FilterChip(
                        label: const Text("全部"),
                        selected: allSelected,
                        onSelected: (selected) {
                          setState(() {
                            if (selected) {
                              _selectedPhases.addAll(_allPhases);
                            } else {
                              _selectedPhases.clear();
                            }
                          });
                        },
                      ),
                    ),
                    ...phaseOptions.map((option) {
                    final selected = _selectedPhases.contains(option[0]);
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: FilterChip(
                        label: Text(option[1]),
                        selected: selected,
                        onSelected: (selected) {
                          setState(() {
                            if (selected) {
                              _selectedPhases.add(option[0]);
                            } else {
                              _selectedPhases.remove(option[0]);
                            }
                          });
                        },
                      ),
                    );
                  })
                  ])),
          Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(
                          child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(_error!, textAlign: TextAlign.center),
                                    const SizedBox(height: 12),
                                    FilledButton(
                                        onPressed: _refresh,
                                        child: const Text("重试"))
                                  ])))
                      : visibleSessions.isEmpty
                          ? Center(
                              child: Text(_sessions.isEmpty
                                  ? "暂无会话"
                                  : _selectedPhases.isEmpty
                                      ? "未选择任何状态标签"
                                      : "当前筛选下没有会话"))
                          : RefreshIndicator(
                              onRefresh: _refresh,
                              child: ListView.separated(
                                  itemCount: visibleSessions.length,
                                  separatorBuilder: (_, __) =>
                                      const Divider(height: 1),
                                  itemBuilder: (context, index) {
                                    final session = visibleSessions[index];
                                    final needsConfirm = session.taskState ==
                                        "needs_confirmation";
                                    return ListTile(
                                        leading: _stateIcon(session),
                                        title: Text(session.name),
                                        subtitle: Text([
                                          session.kind,
                                          if (session.project != null &&
                                              session.project!.isNotEmpty)
                                            session.project!
                                        ].join(" · ")),
                                        trailing: needsConfirm
                                            ? Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                    IconButton(
                                                        tooltip: "拒绝",
                                                        onPressed: () =>
                                                            _resolvePrompt(
                                                                session, false),
                                                        icon: const Icon(
                                                            Icons.close,
                                                            color: Colors.red)),
                                                    IconButton(
                                                        tooltip: "同意",
                                                        onPressed: () =>
                                                            _resolvePrompt(
                                                                session, true),
                                                        icon: const Icon(
                                                            Icons.check,
                                                            color:
                                                                Colors.green)),
                                                    _sessionMenu(session)
                                                  ])
                                            : _sessionMenu(session),
                                        onTap: needsConfirm
                                            ? () => _showPromptContext(session)
                                            : () => _openChat(session),
                                        onLongPress: () =>
                                            _confirmDelete(session));
                                  })))
        ]));
  }
}
