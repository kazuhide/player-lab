import Foundation

/// Serializes bounded local persistence. A failed read never becomes an empty writable store.
actor NativeProfileStore {
    typealias Read = @Sendable (URL) throws -> Data?
    typealias Write = @Sendable (URL, Data) throws -> Void
    private let fileURL: URL
    private let read: Read
    private let write: Write
    private var profiles: [NativeConfigurationProfile]?

    init(fileURL: URL, read: Read? = nil, write: Write? = nil) {
        self.fileURL = fileURL
        self.read = read ?? { try Self.readFile($0) }
        self.write = write ?? { try Self.writeFile($0, $1) }
    }

    private static let sharedApplicationStore: NativeProfileStore? = {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let file = support.appendingPathComponent("PlayerLabProfiles", isDirectory: true)
            .appendingPathComponent("profiles-\(NativeProfileSchema.platform)-v1.json")
        return NativeProfileStore(fileURL: file)
    }()

    static func applicationStore() throws -> NativeProfileStore {
        guard let store = sharedApplicationStore else { throw NativeProfileError.read }
        return store
    }

    func load() throws -> [NativeConfigurationProfile] {
        do {
            let loaded = try read(fileURL).map(NativeProfileCodec.decode) ?? []
            profiles = loaded
            return loaded
        } catch {
            profiles = nil
            throw (error as? NativeProfileError) ?? .read
        }
    }

    func save(_ profile: NativeConfigurationProfile, replacing id: UUID? = nil) throws -> [NativeConfigurationProfile] {
        guard var next = profiles else { throw NativeProfileError.read }
        let normalized = NativeProfileSchema.nameKey(profile.name)
        if let index = next.firstIndex(where: { NativeProfileSchema.nameKey($0.name) == normalized }) {
            guard id == next[index].id else { throw NativeProfileError.duplicate }
            next[index] = profile
        } else {
            guard id == nil else { throw NativeProfileError.invalid }
            next.append(profile)
        }
        return try commit(next)
    }

    func delete(_ id: UUID) throws -> [NativeConfigurationProfile] {
        guard let profiles, profiles.contains(where: { $0.id == id }) else { throw NativeProfileError.invalid }
        return try commit(profiles.filter { $0.id != id })
    }

    func clear() throws -> [NativeConfigurationProfile] { try commit([]) }

    private func commit(_ next: [NativeConfigurationProfile]) throws -> [NativeConfigurationProfile] {
        let bytes = try NativeProfileCodec.encode(next)
        do { try write(fileURL, bytes) } catch { throw NativeProfileError.write }
        profiles = next
        return next
    }

    private static func refuseSymlink(_ url: URL) throws {
        do {
            // NSURL resource values can retain a pre-replacement file type in their cache.
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            if attributes[.type] as? FileAttributeType == .typeSymbolicLink { throw NativeProfileError.read }
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            return
        }
    }

    private static func readFile(_ file: URL) throws -> Data? {
        try refuseSymlink(file.deletingLastPathComponent()); try refuseSymlink(file)
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: file) }
        catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile { return nil }
        defer { try? handle.close() }
        let bytes = try handle.read(upToCount: NativeProfileCodec.collectionLimit + 1) ?? Data()
        guard bytes.count <= NativeProfileCodec.collectionLimit else { throw NativeProfileError.limit }
        return bytes
    }

    private static func writeFile(_ file: URL, _ bytes: Data) throws {
        let directory = file.deletingLastPathComponent()
        try refuseSymlink(directory); try refuseSymlink(file)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        // This dedicated directory contains only this app's profiles, never caller-selected data.
        var owned = directory
        var flags = URLResourceValues(); flags.isExcludedFromBackup = true
        try owned.setResourceValues(flags)
        try bytes.write(to: file, options: .atomic)
    }
}
