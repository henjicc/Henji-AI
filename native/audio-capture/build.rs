use std::{env, fs, path::PathBuf};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let vendor = root.join("vendor");
    let asio = fs::read_to_string(vendor.join("asio-enabled")).unwrap_or_default() == "1";
    let windows = env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows";
    println!("cargo:rerun-if-changed=src/portaudio_bridge.c");
    println!("cargo:rerun-if-changed=vendor/asio-enabled");
    let mut build = cc::Build::new();
    build
        .file("src/portaudio_bridge.c")
        .include(vendor.join("portaudio/include"));
    if windows {
        build.static_crt(true);
    }
    if asio {
        build.define("HENJI_ASIO", "1");
    }
    build.compile("capture_bridge");
    println!(
        "cargo:rustc-link-search=native={}",
        vendor
            .join("build")
            .join(if windows { "Release" } else { "" })
            .display()
    );
    println!(
        "cargo:rustc-link-lib=static={}",
        if windows {
            "portaudio_static_x64"
        } else {
            "portaudio"
        }
    );
    if windows {
        for lib in [
            "winmm", "ole32", "uuid", "dsound", "setupapi", "user32", "advapi32",
        ] {
            println!("cargo:rustc-link-lib={lib}");
        }
    } else {
        for lib in [
            "CoreAudio",
            "AudioToolbox",
            "AudioUnit",
            "CoreFoundation",
            "CoreServices",
        ] {
            println!("cargo:rustc-link-lib=framework={lib}");
        }
    }
}
