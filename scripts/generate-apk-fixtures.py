#!/usr/bin/env python3
"""Generate generic signed APK fixtures and disposable keys; no real app inputs."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def version_key(path):
    return tuple(int(n) for n in re.findall(r"\d+", path.name))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", default=os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT"))
    parser.add_argument("--output", default=str(ROOT / "target/apk-fixtures"))
    parser.add_argument("--large-mib", type=int, default=34)
    args = parser.parse_args()
    sdk = Path(args.sdk) if args.sdk else next((p for p in [Path.home() / "Android/SDK", Path.home() / "Android/Sdk"] if p.exists()), Path("/nonexistent"))
    builds = sorted((sdk / "build-tools").glob("*"), key=version_key)
    platforms = sorted((sdk / "platforms").glob("android-*"), key=version_key)
    if not builds or not platforms:
        parser.error("Set ANDROID_HOME or --sdk to an SDK with build-tools and a platform installed")
    build = builds[-1]
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, JAVA_TOOL_OPTIONS="--enable-native-access=ALL-UNNAMED")

    def run(argv):
        result = subprocess.run([str(v) for v in argv], capture_output=True, text=True, env=env)
        if result.returncode:
            raise RuntimeError(f"{Path(argv[0]).name} failed:\n{result.stdout}\n{result.stderr}")
        return result.stdout

    unsigned = out / "unsigned.apk"
    run([build / "aapt2", "link", "--manifest", ROOT / "tests/fixtures/AndroidManifest.xml",
         "-I", platforms[-1] / "android.jar", "-o", unsigned])
    for label in ["old", "new"]:
        key = out / f"{label}.jks"
        if not key.exists():
            run(["keytool", "-genkeypair", "-keystore", key, "-storepass", "inkparcel-test-only",
                 "-keypass", "inkparcel-test-only", "-alias", label, "-keyalg", "RSA", "-keysize", "2048",
                 "-validity", "3650", "-dname", f"CN=InkParcel disposable {label} fixture", "-noprompt"])
    def signer(label):
        return ["--ks", out / f"{label}.jks", "--ks-key-alias", label, "--ks-pass", "pass:inkparcel-test-only"]

    def sign(name, v1=False, v2=True, v3=False, extra=(), source=unsigned, min_sdk=24):
        run([build / "apksigner", "sign", "--out", out / f"{name}.apk",
             "--min-sdk-version", str(min_sdk), "--v1-signing-enabled", str(v1).lower(),
             "--v2-signing-enabled", str(v2).lower(), "--v3-signing-enabled", str(v3).lower(),
             "--v4-signing-enabled", "false", *signer("old"), *extra, source])
        verify_options = ["--max-sdk-version", "23"] if not v2 else []
        run([build / "apksigner", "verify", "--min-sdk-version", str(min_sdk), *verify_options, out / f"{name}.apk"])
        print(f"Generated and verified {name}.apk")

    sign("v2")
    sign("v1-v2", v1=True, min_sdk=21)
    sign("v2-v3", v3=True)
    sign("verity", v3=True, extra=["--verity-enabled", "true"])
    lineage = out / "rotation.lineage"
    run([build / "apksigner", "rotate", "--out", lineage, "--old-signer", *signer("old"), "--new-signer", *signer("new")])
    sign("v31", v3=True, extra=["--next-signer", *signer("new"), "--lineage", lineage, "--rotation-min-sdk-version", "33"])
    sign("v1-only", v1=True, v2=False, min_sdk=21)
    if args.large_mib > 0:
        large = out / "large-unsigned.apk"
        shutil.copyfile(unsigned, large)
        with zipfile.ZipFile(large, "a", compression=zipfile.ZIP_STORED) as apk:
            with apk.open("assets/fixture-payload.bin", "w") as asset:
                chunk = bytes(range(256)) * 4096
                for _ in range(args.large_mib):
                    asset.write(chunk)
        sign("large", v3=True, source=large)
    (out / "tools.json").write_text(__import__("json").dumps({"apksigner": str(build / "apksigner"), "buildTools": build.name}, indent=2) + "\n")
    print(f"Fixtures: {out}")


if __name__ == "__main__":
    main()
