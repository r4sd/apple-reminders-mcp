/**
 * 繰り返しコマンド（新機能 - Issue #5）
 * - get-recurrence: 繰り返しルール取得
 * - set-recurrence: 繰り返しルール設定
 * - clear-recurrence: 繰り返しルール解除
 *
 * EventKit の EKRecurrenceRule を使用
 * AppleScript では対応できない機能
 */

import ArgumentParser
import EventKit

// ----------------------------------------
// 繰り返しルール取得
// ----------------------------------------
struct GetRecurrence: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get-recurrence",
        abstract: "リマインダーの繰り返しルールを取得"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Option(name: .long, help: "リマインダー名")
    var reminder: String

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let target = try await manager.findReminder(
            listName: list,
            reminderName: reminder
        )
        let output = manager.toOutput(target)

        if let recurrence = output.recurrence {
            try outputJSON(recurrence)
        } else {
            try outputJSON(SuccessOutput(
                success: true,
                message: "繰り返しルールは設定されていません"
            ))
        }
    }
}

// ----------------------------------------
// 繰り返しルール設定
// ----------------------------------------
struct SetRecurrence: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "set-recurrence",
        abstract: "リマインダーに繰り返しルールを設定"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Option(name: .long, help: "リマインダー名")
    var reminder: String

    @Option(name: .long, help: "頻度 (daily, weekly, monthly, yearly)")
    var frequency: String

    @Option(name: .long, help: "間隔（例: 2 → 2日ごと/2週ごと）")
    var interval: Int = 1

    @Option(name: .long, help: "終了回数（例: 10 → 10回で終了）")
    var endCount: Int?

    @Option(name: .long, help: "終了日 (例: 2024-12-31 23:59)")
    var endDate: String?

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let target = try await manager.findReminder(
            listName: list,
            reminderName: reminder
        )

        // 頻度を変換
        let freq: EKRecurrenceFrequency
        switch frequency.lowercased() {
        case "daily": freq = .daily
        case "weekly": freq = .weekly
        case "monthly": freq = .monthly
        case "yearly": freq = .yearly
        default:
            try outputJSON(SuccessOutput(
                success: false,
                message: "無効な頻度: \(frequency) (daily/weekly/monthly/yearly)"
            ))
            return
        }

        // 終了条件を設定
        var end: EKRecurrenceEnd? = nil
        if let count = endCount {
            end = EKRecurrenceEnd(occurrenceCount: count)
        } else if let dateStr = endDate {
            let date = try manager.parseDate(dateStr)
            end = EKRecurrenceEnd(end: date)
        }

        // 既存の繰り返しルールを削除
        if let existingRules = target.recurrenceRules {
            for rule in existingRules {
                target.removeRecurrenceRule(rule)
            }
        }

        // 新しいルールを追加
        let rule = EKRecurrenceRule(
            recurrenceWith: freq,
            interval: interval,
            end: end
        )
        target.addRecurrenceRule(rule)

        try manager.save(target)

        let freqLabel: String
        switch frequency.lowercased() {
        case "daily": freqLabel = interval == 1 ? "毎日" : "\(interval)日ごと"
        case "weekly": freqLabel = interval == 1 ? "毎週" : "\(interval)週ごと"
        case "monthly": freqLabel = interval == 1 ? "毎月" : "\(interval)ヶ月ごと"
        case "yearly": freqLabel = interval == 1 ? "毎年" : "\(interval)年ごと"
        default: freqLabel = frequency
        }

        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」に繰り返し「\(freqLabel)」を設定しました"
        ))
    }
}

// ----------------------------------------
// 繰り返しルール解除
// ----------------------------------------
struct ClearRecurrence: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "clear-recurrence",
        abstract: "リマインダーの繰り返しルールを解除"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Option(name: .long, help: "リマインダー名")
    var reminder: String

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let target = try await manager.findReminder(
            listName: list,
            reminderName: reminder
        )

        if let rules = target.recurrenceRules {
            for rule in rules {
                target.removeRecurrenceRule(rule)
            }
        }

        try manager.save(target)
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」の繰り返しルールを解除しました"
        ))
    }
}
