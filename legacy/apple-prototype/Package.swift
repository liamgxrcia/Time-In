// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "TimeIn",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "CRMCore", targets: ["CRMCore"]),
        .library(name: "CRMData", targets: ["CRMData"]),
        .library(name: "CRMPlatform", targets: ["CRMPlatform"])
    ],
    targets: [
        .target(name: "CRMCore"),
        .target(name: "CRMData", dependencies: ["CRMCore"]),
        .target(name: "CRMPlatform", dependencies: ["CRMCore", "CRMData"]),
        .testTarget(name: "CRMCoreTests", dependencies: ["CRMCore"]),
        .testTarget(name: "CRMDataTests", dependencies: ["CRMCore", "CRMData"])
    ],
    swiftLanguageModes: [.v6]
)
