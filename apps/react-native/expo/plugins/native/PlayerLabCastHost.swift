import Foundation
import BitmovinPlayerCore
import React

/** Stores only public Cast options and submits them before the SDK lifecycle subscriber. */
@objc(PlayerLabCastHost)
final class PlayerLabCastHost: NSObject {
  private static let idKey = "player-lab-cast.applicationId"
  private static let namespaceKey = "player-lab-cast.messageNamespace"
  private static let defaultId = "FFE417E5"
  private static let defaultNamespace = "urn:x-cast:com.bitmovin.player.caf"
  private static var startupOptions: [String: String]?

  @objc static func requiresMainQueueSetup() -> Bool { true }
  private static func savedOptions() -> [String: String] {
    ["applicationId": UserDefaults.standard.string(forKey: idKey) ?? "",
     "messageNamespace": UserDefaults.standard.string(forKey: namespaceKey) ?? ""]
  }
  private static func normalized(_ saved: [String: String]) -> [String: String] {
    ["applicationId": saved["applicationId"].flatMap { $0.isEmpty ? nil : $0 } ?? defaultId,
     "messageNamespace": saved["messageNamespace"].flatMap { $0.isEmpty ? nil : $0 } ?? defaultNamespace]
  }

  static func initializeSavedOptions() {
    precondition(Thread.isMainThread)
    guard !BitmovinCastManager.isInitialized() else { return }
    let values = normalized(savedOptions())
    let options = BitmovinCastManagerOptions()
    options.applicationId = values["applicationId"]
    options.messageNamespace = values["messageNamespace"]
    BitmovinCastManager.initializeCasting(options: options)
    if BitmovinCastManager.isInitialized() { startupOptions = values }
  }

  private static func state() -> [String: Any] {
    let saved = savedOptions()
    return ["savedOptions": saved, "startupOptions": startupOptions as Any? ?? NSNull(),
      "nativeInitialized": BitmovinCastManager.isInitialized(),
      "pendingRestart": startupOptions != normalized(saved),
      "startupEvidence": "Inputs submitted to public initializeCasting(options:) at this process launch; iOS has no public options getter."]
  }

  @objc(readOptions:rejecter:)
  func readOptions(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { resolve(Self.state()) }
  }

  @objc(saveOptions:namespace:resolver:rejecter:)
  func saveOptions(_ applicationId: String, namespace: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    let validId = applicationId.isEmpty || applicationId.range(of: "^[0-9a-fA-F]{8}$", options: .regularExpression) != nil
    let validNamespace = namespace.isEmpty || (namespace.utf8.count <= 128 && namespace.hasPrefix("urn:x-cast:") &&
      namespace.count > 11 && namespace.unicodeScalars.allSatisfy { (33...126).contains(Int($0.value)) })
    guard validId, validNamespace else {
      reject("CastHostSettings", "Use an eight-character hexadecimal receiver ID and a namespace beginning with urn:x-cast: (at most 128 ASCII characters), or leave either blank.", nil)
      return
    }
    DispatchQueue.main.async {
      UserDefaults.standard.set(applicationId, forKey: Self.idKey)
      UserDefaults.standard.set(namespace, forKey: Self.namespaceKey)
      resolve(Self.state())
    }
  }
}
