// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ReferenceDomain",
    targets: [
        .target(name: "ReferenceDomain", path: "Domain"),
        .testTarget(name: "ReferenceDomainTests", dependencies: ["ReferenceDomain"], path: "Tests")
    ]
)
