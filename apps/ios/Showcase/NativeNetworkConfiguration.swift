import Foundation
import ObjectiveC
import BitmovinPlayer

extension AdvancedConfiguration {
    static var nativeNetworkFields: [AdvancedConfigurationField] {
        let note = "The function receives input.type and a request/response object. Edit its url, method, headers or body. body is base64 or null; return the edited object. Invalid results preserve the original and appear in API state."
        return [
            .init("NetworkConfig.preprocessHttpRequest", .player, "networkConfig.preprocessHttpRequest", .script(initial: "return input.request;"), note),
            .init("NetworkConfig.preprocessHttpResponse", .player, "networkConfig.preprocessHttpResponse", .script(initial: "return input.response;"), note + " Responses also have status and request."),
            .init("NetworkConfig.retryHttpRequest", .player, "networkConfig.retryHttpRequest", .script(initial: "return {action: 'abort'};"), "input contains type, retry and response. Return {action: 'retry', delay: seconds, request: input.response.request} or {action: 'abort'}. Exactly one SDK completion is called; invalid results abort and appear in API state."),
            .init("NetworkConfig.preprocessHttpRequestDelegate", .player, "networkConfig.preprocessHttpRequestDelegate", .script(initial: "return input.request;"), note + " Deprecated SDK delegate. The app retains its concrete delegate for the player generation."),
        ]
    }

    func applyNetworkCallbacks(to config: NetworkConfig, runtime: NativeScriptRuntime, sources: [String: String], journal: NativeCallbackJournal?) {
        if sources["NetworkConfig.preprocessHttpRequest"] != nil {
            config.preprocessHttpRequest = { type, request, completion in
                let converted = runtime.call("NetworkConfig.preprocessHttpRequest", input: ["type": type.rawValue, "request": NativeNetworkBridge.input(request)], fallback: request) {
                    NativeNetworkBridge.request($0, fallback: request)
                }
                completion(converted)
            }
        }
        if sources["NetworkConfig.preprocessHttpResponse"] != nil {
            config.preprocessHttpResponse = { type, response, completion in
                let converted = runtime.call("NetworkConfig.preprocessHttpResponse", input: ["type": type.rawValue, "response": NativeNetworkBridge.input(response)], fallback: response) {
                    NativeNetworkBridge.response($0, fallback: response)
                }
                completion(converted)
            }
        }
        if sources["NetworkConfig.retryHttpRequest"] != nil {
            config.retryHttpRequest = { type, retry, response, retryHandler, abortHandler in
                let decision = runtime.call("NetworkConfig.retryHttpRequest", input: ["type": type.rawValue, "retry": retry, "response": NativeNetworkBridge.input(response)], fallback: NativeRetryDecision.abort) { output in
                    guard let object = output as? [String: Any], let action = object["action"] as? String else { return nil }
                    if action == "abort" { return .abort }
                    guard action == "retry", let delay = NativeScriptRuntime.number(object["delay"]), delay >= 0,
                          let request = NativeNetworkBridge.request(object["request"], fallback: response.request) else { return nil }
                    return .retry(delay, request)
                }
                switch decision {
                case .abort: abortHandler()
                case .retry(let delay, let request): retryHandler(delay, request)
                }
            }
        }
        if sources["NetworkConfig.preprocessHttpRequestDelegate"] != nil {
            let delegate = NativeNetworkDelegate(runtime: runtime)
            config.preprocessHttpRequestDelegate = delegate
            journal?.retain(delegate)
            // The SDK property is weak; retain for standalone configuration use as well.
            objc_setAssociatedObject(config, &NativeNetworkDelegate.associationKey, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        }
    }
}

private enum NativeRetryDecision { case abort, retry(TimeInterval, HttpRequest) }

final class NativeNetworkDelegate: NSObject, PreprocessHttpRequestDelegate, @unchecked Sendable {
    static var associationKey: UInt8 = 0
    private let runtime: NativeScriptRuntime
    init(runtime: NativeScriptRuntime) { self.runtime = runtime }

    func preprocessHttpRequest(_ type: String, httpRequest: HttpRequest, completionHandler: @escaping (HttpRequest) -> Void) {
        let converted = runtime.call("NetworkConfig.preprocessHttpRequestDelegate", input: ["type": type, "request": NativeNetworkBridge.input(httpRequest)], fallback: httpRequest) {
            NativeNetworkBridge.request($0, fallback: httpRequest)
        }
        completionHandler(converted)
    }
}

enum NativeNetworkBridge {
    static func input(_ request: HttpRequest) -> [String: Any] {
        ["url": request.url.absoluteString, "method": request.method, "headers": request.headers,
         "body": request.body?.base64EncodedString() as Any? ?? NSNull()]
    }
    static func input(_ response: HttpResponse) -> [String: Any] {
        ["url": response.url.absoluteString, "status": response.status, "headers": response.headers,
         "body": response.body?.base64EncodedString() as Any? ?? NSNull(), "request": input(response.request)]
    }

    static func request(_ value: Any?, fallback: HttpRequest) -> HttpRequest? {
        guard let object = value as? [String: Any],
              let url = url(object["url"], fallback: fallback.url),
              let method = (object["method"] ?? fallback.method) as? String, isToken(method),
              let headers = headers(object["headers"] ?? fallback.headers),
              let body = body(object, fallback: fallback.body) else { return nil }
        let request = HttpRequest(url: url, method: method)
        request.headers = headers
        request.body = body
        return request
    }
    static func response(_ value: Any?, fallback: HttpResponse) -> HttpResponse? {
        guard let object = value as? [String: Any], let url = url(object["url"], fallback: fallback.url),
              let statusValue = NativeScriptRuntime.number(object["status"] ?? fallback.status), let status = Int(exactly: statusValue),
              let headers = headers(object["headers"] ?? fallback.headers),
              let body = body(object, fallback: fallback.body),
              let request = request(object["request"] ?? input(fallback.request), fallback: fallback.request) else { return nil }
        return HttpResponse(request: request, url: url, status: status, headers: headers, body: body)
    }
    private static func url(_ value: Any?, fallback: URL) -> URL? {
        guard let value else { return fallback }
        guard let string = value as? String, let url = URL(string: string), url.scheme != nil else { return nil }
        return url
    }
    private static func headers(_ value: Any) -> [String: String]? {
        guard let values = value as? [String: String], values.allSatisfy({ isToken($0.key) && !$0.value.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" }) }) else { return nil }
        return values
    }
    private static func isToken(_ value: String) -> Bool {
        !value.isEmpty && value.unicodeScalars.allSatisfy { (33...126).contains($0.value) && !"()<>@,;:\\\"/[]?={} \t".unicodeScalars.contains($0) }
    }
    private static func body(_ object: [String: Any], fallback: Data?) -> Data?? {
        guard let value = object["body"] else { return .some(fallback) }
        if value is NSNull { return .some(nil) }
        return NativeScriptRuntime.data(value).map { .some($0) }
    }
}
