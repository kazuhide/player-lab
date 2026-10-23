// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PlaybackCore",
    platforms: [.iOS(.v15), .tvOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "PlaybackCore", targets: ["PlaybackCore"]),
    ],
    targets: [
        .target(name: "PlaybackCore"),
        .testTarget(name: "PlaybackCoreTests", dependencies: ["PlaybackCore"]),
    ]
)
