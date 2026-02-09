/**
 * プロパティ設定コマンド
 * - set-priority: 優先度設定
 * - set-flag: フラグ設定
 * - set-remind-date: 通知日時設定
 */

import ArgumentParser
import EventKit

// ----------------------------------------
// 優先度設定
// ----------------------------------------
struct SetPriority: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "set-priority",
        abstract: "リマインダーの優先度を設定（0=なし, 1=高, 5=中, 9=低）"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Option(name: .long, help: "リマインダー名")
    var reminder: String

    @Option(name: .long, help: "優先度（0=なし, 1=高, 5=中, 9=低）")
    var priority: Int

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let target = try await manager.findReminder(
            listName: list,
            reminderName: reminder
        )
        target.priority = priority
        try manager.save(target)

        let label = priority == 0 ? "なし"
            : priority <= 3 ? "高"
            : priority <= 6 ? "中" : "低"
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」の優先度を「\(label)」に設定しました"
        ))
    }
}

// フラグ設定は EventKit API に存在しないため、AppleScript で処理する
// TypeScript 側で osascript にフォールバックする

// ----------------------------------------
// 通知日時設定
// ----------------------------------------
struct SetRemindDate: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "set-remind-date",
        abstract: "リマインダーの通知日時を設定"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Option(name: .long, help: "リマインダー名")
    var reminder: String

    @Option(name: .long, help: "通知日時 (例: 2024-03-15 09:00)")
    var date: String

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let target = try await manager.findReminder(
            listName: list,
            reminderName: reminder
        )

        let remindDate = try manager.parseDate(date)
        let alarm = EKAlarm(absoluteDate: remindDate)

        // 既存の日時ベースアラームを削除してから追加
        if let existingAlarms = target.alarms {
            for existing in existingAlarms where existing.absoluteDate != nil {
                target.removeAlarm(existing)
            }
        }
        target.addAlarm(alarm)

        try manager.save(target)
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」の通知日時を「\(date)」に設定しました"
        ))
    }
}
