/**
 * CRUD コマンド
 * - add: リマインダー追加
 * - complete: リマインダー完了
 * - delete: リマインダー削除
 * - update: リマインダー更新
 */

import ArgumentParser
import EventKit

// ----------------------------------------
// リマインダー追加
// ----------------------------------------
struct AddReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "add",
        abstract: "新しいリマインダーを追加"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Option(name: .long, help: "タイトル")
    var title: String

    @Option(name: .long, help: "メモ")
    var body: String?

    @Option(name: .long, help: "期日 (例: 2024-03-15 09:00)")
    var dueDate: String?

    func run() async throws {
        let manager = EventKitManager()
        try await manager.requestAccess()
        let calendar = try manager.findList(name: list)

        let reminder = EKReminder(eventStore: manager.store)
        reminder.calendar = calendar
        reminder.title = title
        reminder.notes = body

        if let dueDateStr = dueDate {
            let date = try manager.parseDate(dueDateStr)
            reminder.dueDateComponents = manager.dateToComponents(date)
        }

        try manager.save(reminder)
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(title)」を「\(list)」に追加しました"
        ))
    }
}

// ----------------------------------------
// リマインダー完了
// ----------------------------------------
struct CompleteReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "complete",
        abstract: "リマインダーを完了にする"
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
        target.isCompleted = true
        try manager.save(target)
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」を完了にしました"
        ))
    }
}

// ----------------------------------------
// リマインダー削除
// ----------------------------------------
struct DeleteReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "delete",
        abstract: "リマインダーを削除"
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
        try manager.remove(target)
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」を削除しました"
        ))
    }
}

// ----------------------------------------
// リマインダー更新
// ----------------------------------------
struct UpdateReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "update",
        abstract: "リマインダーの内容を更新"
    )

    @Option(name: .long, help: "リスト名")
    var list: String

    @Option(name: .long, help: "リマインダー名")
    var reminder: String

    @Option(name: .long, help: "新しい名前")
    var newName: String?

    @Option(name: .long, help: "新しいメモ（上書き）")
    var newBody: String?

    @Option(name: .long, help: "メモに追記する内容")
    var appendBody: String?

    @Option(name: .long, help: "新しい期日 (例: 2024-03-15 09:00)")
    var newDueDate: String?

    func run() async throws {
        // 更新項目がない場合は早期リターン
        guard newName != nil || newBody != nil
            || appendBody != nil || newDueDate != nil else {
            try outputJSON(SuccessOutput(
                success: false,
                message: "更新する項目が指定されていません"
            ))
            return
        }

        let manager = EventKitManager()
        try await manager.requestAccess()
        let target = try await manager.findReminder(
            listName: list,
            reminderName: reminder
        )

        if let name = newName {
            target.title = name
        }
        if let body = newBody {
            target.notes = body
        }
        if let append = appendBody {
            target.notes = (target.notes ?? "") + "\n" + append
        }
        if let dueDateStr = newDueDate {
            let date = try manager.parseDate(dueDateStr)
            target.dueDateComponents = manager.dateToComponents(date)
        }

        try manager.save(target)
        try outputJSON(SuccessOutput(
            success: true,
            message: "リマインダー「\(reminder)」を更新しました"
        ))
    }
}
