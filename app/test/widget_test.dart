import 'package:flutter_test/flutter_test.dart';

import 'package:fuluk_app/config.dart';

void main() {
  test("AppConfig builds gateway base url with default scheme", () {
    final config = AppConfig(
      gatewayHost: "192.168.1.10",
      gatewayPort: "8787",
      gatewayToken: "token"
    );
    expect(config.gatewayBaseUrl, "http://192.168.1.10:8787");
    expect(config.gatewayConfigured, isTrue);
  });
}
