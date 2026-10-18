// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DvrKit",
    platforms: [.iOS(.v15), .tvOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "DvrKit", targets: ["DvrKit"]),
    ],
    targets: [
        .target(name: "DvrKit"),
        .testTarget(name: "DvrKitTests", dependencies: ["DvrKit"]),
    ]
)
