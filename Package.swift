// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Onboard",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/jpsim/Yams.git", from: "5.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "Onboard",
            dependencies: ["Yams"],
            path: "Sources/Onboard",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
