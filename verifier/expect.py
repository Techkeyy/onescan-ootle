"""Where the template crate's WASM must appear after a release build. Only this file is accepted as the candidate.

Usage: python -I verifier/expect.py <src_dir> <workdir>   prints {"crate", "lib", "rel"} or {"error"}
rel = <target_directory>/wasm32-unknown-unknown/release/<lib>.wasm, relative to src. It comes from
`cargo metadata --no-deps` (runs no repo code) and must stay inside the repo. Call it only after the
srccheck hard checks have passed (a hostile cargo config is never handed to cargo).
"""
import json, os, subprocess, sys


def expected(src, wd):
    env = {k: v for k, v in os.environ.items() if k not in ("CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR", "RUSTFLAGS")}
    if not os.path.isfile(os.path.join(wd, "Cargo.toml")):
        return {"error": "no Cargo.toml in the workdir: set the recipe workdir to the template crate"}
    r = subprocess.run(["cargo", "metadata", "--no-deps", "--format-version", "1", "--offline"], cwd=wd, env=env,
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        return {"error": "cargo metadata --no-deps failed: " + r.stderr.strip()[-300:]}
    m = json.loads(r.stdout)
    man = os.path.normcase(os.path.realpath(os.path.join(wd, "Cargo.toml")))
    pkg = next((p for p in m.get("packages", []) if os.path.normcase(os.path.realpath(p["manifest_path"])) == man), None)
    if pkg is None:
        return {"error": "the workdir Cargo.toml is not a package (virtual workspace?): set workdir to the template crate"}
    libs = [t for t in pkg.get("targets", []) if "cdylib" in (t.get("crate_types") or []) or "cdylib" in (t.get("kind") or [])]
    if len(libs) != 1:
        return {"error": f"package {pkg['name']} has {len(libs)} cdylib targets (need exactly one)"}
    lib = libs[0]["name"].replace("-", "_")
    root = os.path.normcase(os.path.realpath(src))
    td = os.path.normcase(os.path.realpath(m["target_directory"]))
    if os.path.commonpath([td, root]) != root:
        return {"error": "the target directory is outside the repo"}
    rel = os.path.relpath(os.path.join(td, "wasm32-unknown-unknown", "release", lib + ".wasm"), root).replace("\\", "/")
    return {"crate": pkg["name"], "lib": lib, "rel": rel}


if __name__ == "__main__":
    print(json.dumps(expected(sys.argv[1], sys.argv[2])))
