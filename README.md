# apple-reminders-mcp

macOS Reminders.app を操作する MCP (Model Context Protocol) サーバー。

macOS 26 で既存の MCP サーバー（apple-mcp 等）が動作しなくなったため、osascript を直接ラップするシンプルな実装として作成。

## 機能

| ツール | 説明 |
|--------|------|
| `list_reminder_lists` | リマインダーのリスト一覧を取得 |
| `get_reminders` | 指定したリストのリマインダー一覧を取得 |
| `add_reminder` | 新しいリマインダーを追加 |
| `complete_reminder` | リマインダーを完了にする |
| `delete_reminder` | リマインダーを削除 |
| `update_reminder` | リマインダーの内容を更新（名前、メモ、期日） |
| `set_priority` | 優先度を設定（0=なし, 1=高, 5=中, 9=低） |
| `set_flag` | フラグを設定/解除 |
| `set_remind_date` | 通知日時を設定 |

### 未対応（AppleScript制限）

以下の機能はAppleScriptでは対応できないため、将来的にEventKit（Swift）で対応予定：

- タグ
- 繰り返し（日次/週次など）
- 場所

## 必要環境

- macOS
- [Bun](https://bun.sh/) v1.0 以上
- Reminders.app へのアクセス権限

## インストール

```bash
git clone https://github.com/r4sd/apple-reminders-mcp.git
cd apple-reminders-mcp
bun install
```

## 使い方

### Claude Code で使用

```bash
claude mcp add apple-reminders -- bun /path/to/apple-reminders-mcp/src/index.ts
```

### Claude Desktop で使用

`~/Library/Application Support/Claude/claude_desktop_config.json` に追加：

```json
{
  "mcpServers": {
    "apple-reminders": {
      "command": "bun",
      "args": ["/path/to/apple-reminders-mcp/src/index.ts"]
    }
  }
}
```

### 動作確認

```bash
bun src/index.ts
```

## ライセンス

MIT
