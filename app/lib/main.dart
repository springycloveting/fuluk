import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';
import 'ntfy_service.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const FulukApp());
}

class FulukApp extends StatefulWidget {
  const FulukApp({super.key});

  @override
  State<FulukApp> createState() => _FulukAppState();
}

class _FulukAppState extends State<FulukApp> {
  AppConfig? _config;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final config = AppConfig.fromPrefs(prefs);
    if (config.gatewayConfigured) {
      try {
        await NtfyService.applyConfig(config);
      } catch (_) {}
    }
    setState(() {
      _config = config;
      _ready = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
        title: "Fuluk",
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(seedColor: Colors.blueGrey),
            useMaterial3: true),
        home: !_ready
            ? const Center(child: CircularProgressIndicator())
            : _config!.gatewayConfigured
                ? HomeScreen(config: _config!)
                : SettingsScreen(
                    config: _config!, onSaved: () => setState(() {})));
  }
}
