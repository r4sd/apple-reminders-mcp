/**
 * reminders-helper
 *
 * Apple Reminders を EventKit 経由で操作する CLI ツール
 * apple-reminders-mcp の TypeScript MCP サーバーから呼び出される
 *
 * 全コマンドは JSON を stdout に出力する
 */

import ArgumentParser

@main
struct RemindersHelper: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "reminders-helper",
        abstract: "Apple Reminders EventKit CLI ヘルパー",
        subcommands: [
            // リスト操作
            ListLists.self,
            GetReminders.self,
            // CRUD
            AddReminder.self,
            CompleteReminder.self,
            DeleteReminder.self,
            UpdateReminder.self,
            // プロパティ
            SetPriority.self,
            // SetFlag は EventKit 未対応のため AppleScript で処理
            SetRemindDate.self,
            // 繰り返し（新機能）
            GetRecurrence.self,
            SetRecurrence.self,
            ClearRecurrence.self,
            // 場所（新機能）
            GetLocation.self,
            SetLocation.self,
            ClearLocation.self,
        ]
    )
}
