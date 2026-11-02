// swift-tools-version:5.5

import PackageDescription

let package = Package(
    name: "tauri-plugin-battuta-mobile",
    platforms: [
        .macOS(.v10_13),
        .iOS("18.0"), // the multi-function Core ML package (the `personal` function), since granita v8's personal layer; the string form: `.v18` needs newer tools than this manifest's
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
