/**
 * JSON 出力用のモデル定義
 *
 * 全コマンドの出力は Codable な構造体として定義し、
 * outputJSON() で JSON 文字列に変換して stdout に出力する
 */

import Foundation

// ============================================================
// 出力ヘルパー
// ============================================================

/// Codable な値を JSON 文字列として stdout に出力する
func outputJSON<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(value)
    print(String(data: data, encoding: .utf8)!)
}

/// エラーメッセージを JSON 形式で stdout に出力する
func outputError(_ message: String) {
    // エラーもJSONで返す（TypeScript側でパースしやすい）
    let json = "{\"error\": \"\(message.replacingOccurrences(of: "\"", with: "\\\""))\"}"
    print(json)
}

// ============================================================
// 出力モデル
// ============================================================

/// リスト一覧
struct ListsOutput: Codable {
    let lists: [String]
}

/// リマインダー1件の情報
struct ReminderOutput: Codable {
    let title: String
    let body: String?
    let completed: Bool
    let dueDate: String?
    let priority: Int
    let flagged: Bool
    let hasRecurrence: Bool
    let recurrence: RecurrenceInfo?
    let hasLocation: Bool
    let location: LocationInfo?
}

/// リマインダー一覧
struct RemindersOutput: Codable {
    let reminders: [ReminderOutput]
}

/// 繰り返し情報
struct RecurrenceInfo: Codable {
    let frequency: String   // daily, weekly, monthly, yearly
    let interval: Int
    let endDate: String?
    let endCount: Int?
    let daysOfWeek: [Int]?  // 1=Sunday, 2=Monday, ...
}

/// 場所情報
struct LocationInfo: Codable {
    let title: String?
    let latitude: Double
    let longitude: Double
    let radius: Double
    let proximity: String   // enter, leave, none
}

/// 成功レスポンス
struct SuccessOutput: Codable {
    let success: Bool
    let message: String
}
