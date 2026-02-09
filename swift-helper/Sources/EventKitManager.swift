/**
 * EventKit ラッパー
 *
 * Reminders.app への全アクセスをこのクラスに集約する
 * - アクセス権限のリクエスト
 * - リスト・リマインダーの検索
 * - CRUD 操作
 * - EKReminder → ReminderOutput への変換
 */

import EventKit
import Foundation
import CoreLocation

// ============================================================
// エラー定義
// ============================================================

enum RemindersError: Error, LocalizedError {
    case accessDenied
    case listNotFound(String)
    case reminderNotFound(String)
    case fetchFailed
    case saveFailed(String)
    case invalidDate(String)

    var errorDescription: String? {
        switch self {
        case .accessDenied:
            return "リマインダーへのアクセスが拒否されました"
        case .listNotFound(let name):
            return "リストが見つかりません: \(name)"
        case .reminderNotFound(let name):
            return "リマインダーが見つかりません: \(name)"
        case .fetchFailed:
            return "リマインダーの取得に失敗しました"
        case .saveFailed(let msg):
            return "保存に失敗しました: \(msg)"
        case .invalidDate(let str):
            return "無効な日付形式です: \(str) (期待形式: yyyy-MM-dd HH:mm)"
        }
    }
}

// ============================================================
// EventKitManager 本体
// ============================================================

class EventKitManager {
    let store = EKEventStore()

    /// 日付フォーマッター（"yyyy-MM-dd HH:mm" 形式）
    static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    // ----------------------------------------
    // アクセス権限
    // ----------------------------------------

    /// リマインダーへのフルアクセスをリクエスト
    /// 初回実行時はシステムダイアログが表示される
    func requestAccess() async throws {
        let granted = try await store.requestFullAccessToReminders()
        guard granted else { throw RemindersError.accessDenied }
    }

    // ----------------------------------------
    // リスト操作
    // ----------------------------------------

    /// 全リストを取得
    func getAllLists() -> [EKCalendar] {
        return store.calendars(for: .reminder)
    }

    /// リストを名前で検索
    func findList(name: String) throws -> EKCalendar {
        guard let calendar = store.calendars(for: .reminder)
            .first(where: { $0.title == name }) else {
            throw RemindersError.listNotFound(name)
        }
        return calendar
    }

    // ----------------------------------------
    // リマインダー取得
    // ----------------------------------------

    /// 指定リストのリマインダーを全取得
    func fetchReminders(
        in calendar: EKCalendar,
        includeCompleted: Bool = false
    ) async throws -> [EKReminder] {
        let predicate = store.predicateForReminders(in: [calendar])
        return try await withCheckedThrowingContinuation { continuation in
            store.fetchReminders(matching: predicate) { reminders in
                guard let reminders = reminders else {
                    continuation.resume(throwing: RemindersError.fetchFailed)
                    return
                }
                let filtered = includeCompleted
                    ? reminders
                    : reminders.filter { !$0.isCompleted }
                continuation.resume(returning: filtered)
            }
        }
    }

    /// リマインダーを名前で検索
    func findReminder(listName: String, reminderName: String) async throws -> EKReminder {
        let calendar = try findList(name: listName)
        let reminders = try await fetchReminders(in: calendar, includeCompleted: true)
        guard let reminder = reminders.first(where: { $0.title == reminderName }) else {
            throw RemindersError.reminderNotFound(reminderName)
        }
        return reminder
    }

    // ----------------------------------------
    // 保存・削除
    // ----------------------------------------

    /// リマインダーを保存（新規作成・更新共通）
    func save(_ reminder: EKReminder) throws {
        do {
            try store.save(reminder, commit: true)
        } catch {
            throw RemindersError.saveFailed(error.localizedDescription)
        }
    }

    /// リマインダーを削除
    func remove(_ reminder: EKReminder) throws {
        do {
            try store.remove(reminder, commit: true)
        } catch {
            throw RemindersError.saveFailed(error.localizedDescription)
        }
    }

    // ----------------------------------------
    // 日付ユーティリティ
    // ----------------------------------------

    /// 文字列 → Date に変換
    func parseDate(_ dateString: String) throws -> Date {
        guard let date = Self.dateFormatter.date(from: dateString) else {
            throw RemindersError.invalidDate(dateString)
        }
        return date
    }

    /// Date → DateComponents に変換
    func dateToComponents(_ date: Date) -> DateComponents {
        return Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: date
        )
    }

    // ----------------------------------------
    // EKReminder → ReminderOutput 変換
    // ----------------------------------------

    /// EKReminder を JSON 出力用の ReminderOutput に変換
    func toOutput(_ reminder: EKReminder) -> ReminderOutput {
        // 期日
        var dueDateStr: String? = nil
        if let components = reminder.dueDateComponents,
           let date = Calendar.current.date(from: components) {
            dueDateStr = Self.dateFormatter.string(from: date)
        }

        // 繰り返し情報
        let hasRecurrence = reminder.hasRecurrenceRules
            && !(reminder.recurrenceRules?.isEmpty ?? true)
        var recurrenceInfo: RecurrenceInfo? = nil
        if hasRecurrence, let rule = reminder.recurrenceRules?.first {
            recurrenceInfo = ruleToInfo(rule)
        }

        // 場所情報
        var locationInfo: LocationInfo? = nil
        var hasLocation = false
        if let alarms = reminder.alarms {
            for alarm in alarms {
                if let loc = alarm.structuredLocation,
                   let geo = loc.geoLocation {
                    hasLocation = true
                    let prox: String
                    switch alarm.proximity {
                    case .enter: prox = "enter"
                    case .leave: prox = "leave"
                    default: prox = "none"
                    }
                    locationInfo = LocationInfo(
                        title: loc.title,
                        latitude: geo.coordinate.latitude,
                        longitude: geo.coordinate.longitude,
                        radius: loc.radius,
                        proximity: prox
                    )
                    break
                }
            }
        }

        return ReminderOutput(
            title: reminder.title ?? "",
            body: reminder.notes,
            completed: reminder.isCompleted,
            dueDate: dueDateStr,
            priority: reminder.priority,
            // isFlagged は EventKit API に存在しない（AppleScript でのみ操作可能）
            flagged: false,
            hasRecurrence: hasRecurrence,
            recurrence: recurrenceInfo,
            hasLocation: hasLocation,
            location: locationInfo
        )
    }

    /// EKRecurrenceRule → RecurrenceInfo に変換
    private func ruleToInfo(_ rule: EKRecurrenceRule) -> RecurrenceInfo {
        let freq: String
        switch rule.frequency {
        case .daily: freq = "daily"
        case .weekly: freq = "weekly"
        case .monthly: freq = "monthly"
        case .yearly: freq = "yearly"
        @unknown default: freq = "unknown"
        }

        var endDate: String? = nil
        var endCount: Int? = nil
        if let end = rule.recurrenceEnd {
            if let date = end.endDate {
                endDate = Self.dateFormatter.string(from: date)
            }
            if end.occurrenceCount > 0 {
                endCount = end.occurrenceCount
            }
        }

        let daysOfWeek = rule.daysOfTheWeek?.map { $0.dayOfTheWeek.rawValue }

        return RecurrenceInfo(
            frequency: freq,
            interval: rule.interval,
            endDate: endDate,
            endCount: endCount,
            daysOfWeek: daysOfWeek
        )
    }
}
