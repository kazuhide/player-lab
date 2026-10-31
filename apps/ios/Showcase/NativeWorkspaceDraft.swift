import Foundation
import Combine

final class NativeWorkspaceDraft: ObservableObject {
    @Published var value: ConfigurationDraft
    @Published var applied: ConfigurationDraft
    init(_ draft: ConfigurationDraft) { value = draft; applied = draft }

    func restoreProfile(_ profile: NativeConfigurationProfile, sdkVersion: String, confirmDifferentSDK: Bool = false) throws {
        value = try profile.restored(into: value, sdkVersion: sdkVersion, confirmDifferentSDK: confirmDifferentSDK)
    }

    func synchronize(_ next: ConfigurationDraft) {
        // Rebase untouched fields when a source preset or host change updates the applied model.
        // A draft edit must not restore unrelated settings from the retired source/player.
        func rebase<T: Equatable>(_ path: WritableKeyPath<ConfigurationDraft, T>) {
            if value[keyPath: path] == applied[keyPath: path] { value[keyPath: path] = next[keyPath: path] }
        }
        rebase(\.sourceURL); rebase(\.sourceType); rebase(\.title); rebase(\.posterURL)
        rebase(\.startOffset); rebase(\.timelineReference)
        rebase(\.autoplay); rebase(\.startMuted); rebase(\.sdkTimeShiftEnabled)
        rebase(\.maximumBitrate); rebase(\.forwardBuffer); rebase(\.videoScaling)
        rebase(\.audioLanguage); rebase(\.subtitleMode); rebase(\.subtitleLanguage)
        for id in Set(value.advancedValues.keys).union(applied.advancedValues.keys).union(next.advancedValues.keys) {
            if value.advancedValues[id] == applied.advancedValues[id] {
                value.advancedValues[id] = next.advancedValues[id]
            }
        }
        applied = next
    }

    func replaceSourcePreset(_ next: ConfigurationDraft) {
        value.sourceURL = next.sourceURL; value.sourceType = next.sourceType
        value.title = next.title; value.posterURL = next.posterURL
        value.startOffset = next.startOffset; value.timelineReference = next.timelineReference
        value.audioLanguage = next.audioLanguage; value.subtitleMode = next.subtitleMode
        value.subtitleLanguage = next.subtitleLanguage
        for field in AdvancedConfiguration.fields where field.owner == .source {
            value.advancedValues[field.id] = next.advancedValues[field.id]
        }
        synchronize(next)
    }
}

