# saijiki

Requires Node 20+ and a stable Rust toolchain.

## Run

```bash
npm install
npm run tauri dev
```

## Run against the seeded dev store

```bash
npm run seed
npm run dev:store
```

`npm run seed:clear` empties it.

## Test

```bash
npm test
cd src-tauri && cargo test
```

## Build the installer

```bash
npm run tauri build
```

Output: `src-tauri/target/release/bundle/nsis/saijiki_<version>_x64-setup.exe`
