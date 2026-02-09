/**
 * リスト操作コマンド
 * - list-lists: リスト一覧取得
 * - get-reminders: 指定リストのリマインダー一覧取得
 */

import ArgumentParser
import EventKit

// ----------------------------------------
// リスト一覧取得
// ----------------------------------------
struct ListLists: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "list-lists",
        abstract: "リマインダーリスト一覧を取得"
    )

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let lists = manager.getAllLists().map { $0.title }
        try outputJSON(ListsOutput(lists: lists))
    }
}

// ----------------------------------------
// リマインダー一覧取得
// ----------------------------------------
struct GetReminders: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get-reminders",
        abstract: "指定リストのリマインダー一覧を取得"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Flag(name: .long, help: "完了済みも含める")
    var includeCompleted = false

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let calendar = try manager.findList(name: list)
        let reminders = try await manager.fetchReminders(
            in: calendar,
            includeCompleted: includeCompleted
        )
        let output = RemindersOutput(
            reminders: reminders.map { manager.toOutput($0) }
        )
        try outputJSON(output)
    }
}
