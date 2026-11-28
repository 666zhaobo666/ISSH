#!/usr/bin/env node
// 版本号同步脚本 —— 单一版本源。
// 唯一版本源：apps/desktop/src-tauri/tauri.conf.json 的 version 字段。
// 本脚本把该版本同步到所有 package.json（root / desktop / admin / core），
// 前端 APP_VERSION 则在构建时由 vite.config.ts 自动注入，无需手动维护。
//
// 发版流程：
//   1. 修改 apps/desktop/src-tauri/tauri.conf.json 的 version
//   2. 运行 `npm run version:sync`
//   3. git tag v<version> 并推送触发流水线
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const tauriConf = JSON.parse(
  readFileSync(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')
);
const version = tauriConf.version;

if (!version || typeof version !== 'string') {
  console.error('✘ 未在 tauri.conf.json 中找到 version 字段');
  process.exit(1);
}

const pkgFiles = [
  'package.json',
  'apps/desktop/package.json',
  'apps/admin/package.json',
  'packages/core/package.json',
];

let changed = 0;
for (const rel of pkgFiles) {
  const p = resolve(root, rel);
  const pkg = JSON.parse(readFileSync(p, 'utf8'));
  const prev = pkg.version;
  if (prev !== version) {
    pkg.version = version;
    writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✔ ${rel}: ${prev} -> ${version}`);
    changed++;
  } else {
    console.log(`- ${rel}: ${version} (不变)`);
  }
}

// Cargo.toml 是 TOML，[package] 下的 version 字段也要同步（Rust crate 版本）
const cargoTomlRel = 'apps/desktop/src-tauri/Cargo.toml';
const cargoTomlPath = resolve(root, cargoTomlRel);
let cargoToml = readFileSync(cargoTomlPath, 'utf8');
const cargoPrev = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
if (cargoPrev && cargoPrev !== version) {
  cargoToml = cargoToml.replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${version}"`);
  writeFileSync(cargoTomlPath, cargoToml);
  console.log(`✔ ${cargoTomlRel}: ${cargoPrev} -> ${version}`);
  changed++;
} else if (cargoPrev) {
  console.log(`- ${cargoTomlRel}: ${version} (不变)`);
} else {
  console.warn(`! ${cargoTomlRel}: 未找到 [package] version 字段，已跳过`);
}

console.log(`\n版本源: apps/desktop/src-tauri/tauri.conf.json → ${version}（${changed} 个文件已同步）`);
