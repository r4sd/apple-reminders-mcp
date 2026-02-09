# apple-reminders-mcp

macOS Reminders.app を操作する MCP (Model Context Protocol) サーバー。

EventKit (Swift CLI) をバックエンドとして使用し、繰り返し・場所ベース通知など高度な機能に対応。

## 機能

### 基本操作

| ツール | 説明 |
|--------|------|
| `list_reminder_lists` | リマインダーのリスト一覧を取得 |
| `get_reminders` | 指定したリストのリマインダー一覧を取得 |
| `add_reminder` | 新しいリマインダーを追加 |
| `complete_reminder` | リマインダーを完了にする |
| `delete_reminder` | リマインダーを削除 |
| `update_reminder` | リマインダーの内容を更新（名前、メモ、期日） |

### プロパティ設定

| ツール | 説明 |
|--------|------|
| `set_priority` | 優先度を設定（0=なし, 1=高, 5=中, 9=低） |
| `set_flag` | フラグを設定/解除 |
| `set_remind_date` | 通知日時を設定 |

### 繰り返し（EventKit）

| ツール | 説明 |
|--------|------|
| `get_recurrence` | 繰り返しルールを取得 |
| `set_recurrence` | 繰り返しルールを設定（日次/週次/月次/年次） |
| `clear_recurrence` | 繰り返しルールを解除 |

### 場所ベース通知（EventKit）

| ツール | 説明 |
|--------|------|
| `get_location` | 場所情報を取得 |
| `set_location` | 場所ベースの通知を設定（到着時/出発時） |
| `clear_location` | 場所ベース通知を解除 |

### API 制限

| 機能 | 状態 | 備考 |
|------|------|------|
| タグ | 未対応 | EventKit / AppleScript ともに API 未公開（[#4](https://github.com/r4sd/apple-reminders-mcp/issues/4)） |
| フラグ | AppleScript | EventKit に `isFlagged` プロパティが存在しないため AppleScript で処理 |

## アーキテクチャ

```
TypeScript MCP Server (Bun)
  ├─ Swift CLI (EventKit)     → メイン: 全操作を担当
  └─ osascript (AppleScript)  → フォールバック: フラグ設定のみ
```

Swift CLI ヘルパー (`swift-helper/`) は EventKit 経由で Reminders.app を操作し、JSON で結果を返す。
TypeScript MCP サーバー (`src/index.ts`) が CLI を呼び出して Claude との通信を仲介する。

## 必要環境

- macOS 14 (Sonoma) 以上
- [Bun](https://bun.sh/) v1.0 以上
- Swift 5.9 以上（Xcode 付属）
- Reminders.app へのアクセス権限

## インストール

```bash
git clone https://github.com/r4sd/apple-reminders-mcp.git
cd apple-reminders-mcp

# 依存パッケージをインストール
bun install

# Swift CLI ヘルパーをビルド
cd swift-helper && swift build -c release && cd ..
```

> 初回実行時に Reminders.app へのアクセス許可ダイアログが表示されます。

## 使い方

### Claude Code で使用

```bash
claude mcp add apple-reminders-mcp -- bun /path/to/apple-reminders-mcp/src/index.ts
```

### Claude Desktop で使用

`~/Library/Application Support/Claude/claude_desktop_config.json` に追加：

```json
{
  "mcpServers": {
    "apple-reminders-mcp": {
      "command": "bun",
      "args": ["/path/to/apple-reminders-mcp/src/index.ts"]
    }
  }
}
```

### 動作確認

```bash
# MCP サーバー起動
bun src/index.ts

# Swift CLI 単体テスト
swift-helper/.build/release/reminders-helper list-lists
swift-helper/.build/release/reminders-helper get-reminders --list "Backlog"
```

## ライセンス

MIT
