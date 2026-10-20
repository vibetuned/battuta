// swift-tools-version:5.5

import PackageDescription

let package = Package(
    name: "tauri-plugin-battuta-mobile",
    platforms: [
        .macOS(.v10_13),
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-battuta-mobile",
            type: .static,
            targets: ["tauri-plugin-battuta-mobile"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-battuta-mobile",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources",
            linkerSettings: [
                // Apple's Bluetooth MIDI view (CABTMIDICentralViewController).
                .linkedFramework("CoreAudioKit"),
            ])
    ]
)
