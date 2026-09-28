import 'package:shared_preferences/shared_preferences.dart';

class AppConfig {
  String gatewayHost;
  String gatewayPort;
  String gatewayToken;
  String asrBaseUrl;
  String asrModel;
  String asrApiKey;
  String polishBaseUrl;
  String polishModel;
  String polishApiKey;

  AppConfig(
      {this.gatewayHost = "",
      this.gatewayPort = "8787",
      this.gatewayToken = "",
      this.asrBaseUrl = "",
      this.asrModel = "",
      this.asrApiKey = "",
      this.polishBaseUrl = "",
      this.polishModel = "",
      this.polishApiKey = ""});

  String get gatewayBaseUrl {
    var host = gatewayHost.trim();
    if (host.isEmpty) return "";
    if (!host.startsWith("http://") && !host.startsWith("https://")) {
      host = "http://$host";
    }
    return "$host:${gatewayPort.trim()}";
  }

  bool get gatewayConfigured =>
      gatewayHost.trim().isNotEmpty &&
      gatewayPort.trim().isNotEmpty &&
      gatewayToken.trim().isNotEmpty;

  bool get asrConfigured =>
      asrBaseUrl.trim().isNotEmpty && asrModel.trim().isNotEmpty;

  bool get polishConfigured =>
      polishBaseUrl.trim().isNotEmpty && polishModel.trim().isNotEmpty;

  static AppConfig fromPrefs(SharedPreferences prefs) {
    return AppConfig(
        gatewayHost: prefs.getString("gatewayHost") ?? "",
        gatewayPort: prefs.getString("gatewayPort") ?? "8787",
        gatewayToken: prefs.getString("gatewayToken") ?? "",
        asrBaseUrl: prefs.getString("asrBaseUrl") ?? "",
        asrModel: prefs.getString("asrModel") ?? "",
        asrApiKey: prefs.getString("asrApiKey") ?? "",
        polishBaseUrl: prefs.getString("polishBaseUrl") ?? "",
        polishModel: prefs.getString("polishModel") ?? "",
        polishApiKey: prefs.getString("polishApiKey") ?? "");
  }

  Future<void> save() async {
    const keys = [
      "gatewayHost",
      "gatewayPort",
      "gatewayToken",
      "asrBaseUrl",
      "asrModel",
      "asrApiKey",
      "polishBaseUrl",
      "polishModel",
      "polishApiKey"
    ];
    final values = [
      gatewayHost,
      gatewayPort,
      gatewayToken,
      asrBaseUrl,
      asrModel,
      asrApiKey,
      polishBaseUrl,
      polishModel,
      polishApiKey
    ];
    final prefs = await SharedPreferences.getInstance();
    for (var i = 0; i < keys.length; i++) {
      await prefs.setString(keys[i], values[i]);
    }
  }
}
