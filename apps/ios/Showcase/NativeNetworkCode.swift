import Foundation

extension AdvancedConfiguration {
    func nativeNetworkCode(sources: [String: String], name: String) -> [String] {
        guard sources.keys.contains(where: { $0.hasPrefix("NetworkConfig.") }) else { return [] }
        let support = #"""
        func \#(name)RequestInput(_ request: HttpRequest) -> [String: Any] {
            ["url": request.url.absoluteString, "method": request.method, "headers": request.headers, "body": request.body?.base64EncodedString() as Any? ?? NSNull()]
        }
        func \#(name)ResponseInput(_ response: HttpResponse) -> [String: Any] {
            ["url": response.url.absoluteString, "status": response.status, "headers": response.headers, "body": response.body?.base64EncodedString() as Any? ?? NSNull(), "request": \#(name)RequestInput(response.request)]
        }
        func \#(name)Token(_ value: String) -> Bool {
            !value.isEmpty && value.unicodeScalars.allSatisfy { (33...126).contains($0.value) && !"()<>@,;:\\\"/[]?={} \t".unicodeScalars.contains($0) }
        }
        func \#(name)Headers(_ value: Any) -> [String: String]? {
            guard let headers = value as? [String: String], headers.allSatisfy({ \#(name)Token($0.key) && !$0.value.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" }) }) else { return nil }
            return headers
        }
        func \#(name)Body(_ object: [String: Any], fallback: Data?) -> Data?? {
            guard let value = object["body"] else { return .some(fallback) }
            if value is NSNull { return .some(nil) }
            return \#(name)Data(value).map { .some($0) }
        }
        func \#(name)Request(_ value: Any?, fallback: HttpRequest) -> HttpRequest? {
            guard let object = value as? [String: Any], let urlString = (object["url"] ?? fallback.url.absoluteString) as? String, let url = URL(string: urlString), url.scheme != nil,
                  let method = (object["method"] ?? fallback.method) as? String, \#(name)Token(method),
                  let headers = \#(name)Headers(object["headers"] ?? fallback.headers), let body = \#(name)Body(object, fallback: fallback.body) else { return nil }
            let request = HttpRequest(url: url, method: method)
            request.headers = headers
            request.body = body
            return request
        }
        func \#(name)Response(_ value: Any?, fallback: HttpResponse) -> HttpResponse? {
            guard let object = value as? [String: Any], let urlString = (object["url"] ?? fallback.url.absoluteString) as? String, let url = URL(string: urlString), url.scheme != nil,
                  let number = (object["status"] ?? fallback.status) as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite, let status = Int(exactly: number.doubleValue),
                  let headers = \#(name)Headers(object["headers"] ?? fallback.headers), let body = \#(name)Body(object, fallback: fallback.body),
                  let request = \#(name)Request(object["request"] ?? \#(name)RequestInput(fallback.request), fallback: fallback.request) else { return nil }
            return HttpResponse(request: request, url: url, status: status, headers: headers, body: body)
        }
        """#
        var lines = support.components(separatedBy: "\n")
        if sources["NetworkConfig.preprocessHttpRequest"] != nil {
            lines += ["playerConfig.networkConfig.preprocessHttpRequest = { type, request, completion in",
                "    completion(\(name)Request(\(name)(\"NetworkConfig.preprocessHttpRequest\", [\"type\": type.rawValue, \"request\": \(name)RequestInput(request)]), fallback: request) ?? request)", "}"]
        }
        if sources["NetworkConfig.preprocessHttpResponse"] != nil {
            lines += ["playerConfig.networkConfig.preprocessHttpResponse = { type, response, completion in",
                "    completion(\(name)Response(\(name)(\"NetworkConfig.preprocessHttpResponse\", [\"type\": type.rawValue, \"response\": \(name)ResponseInput(response)]), fallback: response) ?? response)", "}"]
        }
        if sources["NetworkConfig.retryHttpRequest"] != nil {
            lines += ["playerConfig.networkConfig.retryHttpRequest = { type, retry, response, retryHandler, abortHandler in",
                "    let output = \(name)(\"NetworkConfig.retryHttpRequest\", [\"type\": type.rawValue, \"retry\": retry, \"response\": \(name)ResponseInput(response)]) as? [String: Any]",
                "    guard output?[\"action\"] as? String == \"retry\", let number = output?[\"delay\"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite, number.doubleValue >= 0,",
                "          let request = \(name)Request(output?[\"request\"], fallback: response.request) else { abortHandler(); return }",
                "    retryHandler(number.doubleValue, request)", "}"]
        }
        if sources["NetworkConfig.preprocessHttpRequestDelegate"] != nil {
            lines += ["final class ExportedNetworkDelegate: NSObject, PreprocessHttpRequestDelegate, @unchecked Sendable {",
                "    let transform: (String, HttpRequest) -> HttpRequest",
                "    init(transform: @escaping (String, HttpRequest) -> HttpRequest) { self.transform = transform }",
                "    func preprocessHttpRequest(_ type: String, httpRequest: HttpRequest, completionHandler: @escaping (HttpRequest) -> Void) { completionHandler(transform(type, httpRequest)) }", "}",
                "let networkDelegate = ExportedNetworkDelegate { type, request in",
                "    \(name)Request(\(name)(\"NetworkConfig.preprocessHttpRequestDelegate\", [\"type\": type, \"request\": \(name)RequestInput(request)]), fallback: request) ?? request", "}",
                "// The SDK property is weak. Retain networkDelegate alongside the player.",
                "playerConfig.networkConfig.preprocessHttpRequestDelegate = networkDelegate"]
        }
        return lines
    }
}
