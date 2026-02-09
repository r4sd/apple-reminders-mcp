/**
 * 場所コマンド（新機能 - Issue #6）
 * - get-location: 場所情報取得
 * - set-location: 場所ベースの通知設定
 * - clear-location: 場所ベースの通知解除
 *
 * EventKit の EKStructuredLocation + EKAlarm.proximity を使用
 * AppleScript では対応できない機能
 *
 * 注意: 座標（緯度経度）は直接指定する必要がある
 * CLIツールでは現在地の自動取得ができないため
 */

import ArgumentParser
import EventKit
import CoreLocation

// ----------------------------------------
// 場所情報取得
// ----------------------------------------
struct GetLocation: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get-location",
        abstract: "リマインダーの場所情報を取得"
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

        if let location = output.location {
            try outputJSON(location)
        } else {
            try outputJSON(SuccessOutput(
                success: true,
                message: "場所ベースの通知は設定されていません"
            ))
        }
    }
}

// ----------------------------------------
// 場所ベースの通知設定
// ----------------------------------------
struct SetLocation: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "set-location",
        abstract: "リマインダーに場所ベースの通知を設定"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Option(name: .long, help: "リマインダー名")
    var reminder: String

    @Option(name: .long, help: "場所名（例: 職場）")
    var title: String

    @Option(name: .long, help: "緯度")
    var latitude: Double

    @Option(name: .long, help: "経度")
    var longitude: Double

    @Option(name: .long, help: "半径（メートル、デフォルト: 100）")
    var radius: Double = 100.0

    @Option(name: .long, help: "トリガー条件 (enter=到着時, leave=出発時)")
    var proximity: String = "enter"

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let target = try await manager.findReminder(
            listName: list,
            reminderName: reminder
        )

        // proximity を変換
        let ekProximity: EKAlarmProximity
        switch proximity.lowercased() {
        case "enter": ekProximity = .enter
        case "leave": ekProximity = .leave
        default:
            try outputJSON(SuccessOutput(
                success: false,
                message: "無効なトリガー条件: \(proximity) (enter/leave)"
            ))
            return
        }

        // 既存の場所ベースアラームを削除
        if let existingAlarms = target.alarms {
            for alarm in existingAlarms where alarm.structuredLocation != nil {
                target.removeAlarm(alarm)
            }
        }

        // 場所情報を設定
        let location = EKStructuredLocation(title: title)
        location.geoLocation = CLLocation(
            latitude: latitude,
            longitude: longitude
        )
        location.radius = radius

        // アラームを作成して追加
        let alarm = EKAlarm()
        alarm.structuredLocation = location
        alarm.proximity = ekProximity
        target.addAlarm(alarm)

        try manager.save(target)

        let triggerLabel = proximity == "enter" ? "到着時" : "出発時"
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」に場所通知を設定しました（\(title) - \(triggerLabel)）"
        ))
    }
}

// ----------------------------------------
// 場所ベースの通知解除
// ----------------------------------------
struct ClearLocation: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "clear-location",
        abstract: "リマインダーの場所ベース通知を解除"
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

        // 場所ベースのアラームのみ削除（日時ベースは残す）
        if let alarms = target.alarms {
            for alarm in alarms where alarm.structuredLocation != nil {
                target.removeAlarm(alarm)
            }
        }

        try manager.save(target)
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」の場所ベース通知を解除しました"
        ))
    }
}
