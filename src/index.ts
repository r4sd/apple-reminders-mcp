/**
 * apple-reminders-mcp
 *
 * macOS Reminders.appを操作するMCPサーバー
 * EventKit（Swift CLI ヘルパー）経由で Reminders.app と通信する
 *
 * 【動作の流れ】
 * 1. Claude Code/Desktop がこのサーバーを起動
 * 2. サーバーは「こんなツールがあるよ」とClaudeに伝える
 * 3. Claudeがツールを呼び出す（例: list_reminder_lists）
 * 4. サーバーが Swift CLI ヘルパー（reminders-helper）を実行
 * 5. ヘルパーが EventKit で Reminders.app を操作し、JSON で結果を返す
 * 6. サーバーが結果をClaudeに返す
 *
 * 【バックエンド】
 * - メイン: Swift CLI（EventKit） → 繰り返し・場所など高度な機能に対応
 * - フォールバック: AppleScript（osascript） → フラグ設定のみ（EventKit 未対応のため）
 */

// ============================================================
// ライブラリの読み込み
// ============================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve, dirname } from "path";

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * Swift CLI ヘルパーのパス
 * swift-helper/.build/release/reminders-helper を使用
 */
const HELPER_PATH = resolve(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "swift-helper",
  ".build",
  "release",
  "reminders-helper"
);

/**
 * Swift CLI ヘルパーを実行する
 *
 * サブコマンドと引数を渡して実行し、JSON レスポンスを返す
 *
 * @param args - コマンドライン引数の配列（例: ["list-lists"]）
 * @returns パース済みの JSON オブジェクト
 */
async function runHelper(args: string[]): Promise<any> {
  const proc = Bun.spawn([HELPER_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    // ヘルパーのエラー出力を確認
    const errorMsg = stderr.trim() || stdout.trim();
    throw new Error(`reminders-helper エラー: ${errorMsg}`);
  }

  // JSON パース（ヘルパーは常に JSON を出力する）
  try {
    return JSON.parse(stdout.trim());
  } catch {
    // JSON パースに失敗した場合はテキストとして返す
    return { text: stdout.trim() };
  }
}

/**
 * AppleScript を実行するヘルパー関数
 * フラグ設定など EventKit で対応できない機能のフォールバック用
 */
async function runAppleScript(script: string): Promise<string> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`AppleScript エラー: ${stderr}`);
  }

  return stdout.trim();
}

// ============================================================
// MCPサーバーの作成
// ============================================================

const server = new McpServer({
  name: "apple-reminders-mcp",
  version: "2.0.0",
});

// ============================================================
// ツールの登録
// ============================================================

// ----------------------------------------
// 1. リスト一覧取得
// ----------------------------------------
server.tool(
  "list_reminder_lists",
  "リマインダーのリスト一覧を取得",
  {},
  async () => {
    const result = await runHelper(["list-lists"]);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result.lists, null, 2),
        },
      ],
    };
  }
);

// ----------------------------------------
// 2. 特定リストのリマインダー一覧取得
// ----------------------------------------
server.tool(
  "get_reminders",
  "指定したリストのリマインダー一覧を取得",
  {
    listName: z.string().describe("リスト名"),
    includeCompleted: z
      .boolean()
      .optional()
      .default(false)
      .describe("完了済みも含めるか"),
  },
  async ({ listName, includeCompleted }) => {
    const args = ["get-reminders", "--list", listName];
    if (includeCompleted) {
      args.push("--include-completed");
    }
    const result = await runHelper(args);
    return {
      content: [
        {
          type: "text" as const,
          text: result.reminders?.length
            ? JSON.stringify(result.reminders, null, 2)
            : "リマインダーがありません",
        },
      ],
    };
  }
);

// ----------------------------------------
// 3. リマインダー追加
// ----------------------------------------
server.tool(
  "add_reminder",
  "新しいリマインダーを追加",
  {
    listName: z.string().describe("追加先のリスト名"),
    title: z.string().describe("リマインダーのタイトル"),
    body: z.string().optional().describe("メモ・詳細"),
    dueDate: z
      .string()
      .optional()
      .describe('期日（例: "2024-03-15 17:00"）'),
  },
  async ({ listName, title, body, dueDate }) => {
    const args = ["add", "--list", listName, "--title", title];
    if (body) args.push("--body", body);
    if (dueDate) args.push("--due-date", dueDate);

    const result = await runHelper(args);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ----------------------------------------
// 4. リマインダー完了
// ----------------------------------------
server.tool(
  "complete_reminder",
  "リマインダーを完了にする",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
  },
  async ({ listName, reminderName }) => {
    const result = await runHelper([
      "complete",
      "--list", listName,
      "--reminder", reminderName,
    ]);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ----------------------------------------
// 5. リマインダー削除
// ----------------------------------------
server.tool(
  "delete_reminder",
  "リマインダーを削除",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("削除するリマインダー名"),
  },
  async ({ listName, reminderName }) => {
    const result = await runHelper([
      "delete",
      "--list", listName,
      "--reminder", reminderName,
    ]);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ----------------------------------------
// 6. リマインダー更新
// ----------------------------------------
server.tool(
  "update_reminder",
  "リマインダーの内容を更新（名前、メモ、期日）",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("更新するリマインダー名"),
    newName: z.string().optional().describe("新しい名前"),
    newBody: z.string().optional().describe("新しいメモ（上書き）"),
    appendBody: z.string().optional().describe("メモに追記する内容"),
    newDueDate: z.string().optional().describe('新しい期日（例: "2024-03-15 17:00"）'),
  },
  async ({ listName, reminderName, newName, newBody, appendBody, newDueDate }) => {
    const args = ["update", "--list", listName, "--reminder", reminderName];
    if (newName) args.push("--new-name", newName);
    if (newBody) args.push("--new-body", newBody);
    if (appendBody) args.push("--append-body", appendBody);
    if (newDueDate) args.push("--new-due-date", newDueDate);

    const result = await runHelper(args);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ----------------------------------------
// 7. 優先度設定
// ----------------------------------------
server.tool(
  "set_priority",
  "リマインダーの優先度を設定（0=なし, 1=高, 5=中, 9=低）",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
    priority: z.number().min(0).max(9).describe("優先度（0=なし, 1=高, 5=中, 9=低）"),
  },
  async ({ listName, reminderName, priority }) => {
    const result = await runHelper([
      "set-priority",
      "--list", listName,
      "--reminder", reminderName,
      "--priority", String(priority),
    ]);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ----------------------------------------
// 8. フラグ設定（AppleScript フォールバック）
// EventKit API にフラグ機能が存在しないため、AppleScript で処理
// ----------------------------------------
server.tool(
  "set_flag",
  "リマインダーのフラグを設定/解除",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
    flagged: z.boolean().describe("フラグを付けるか（true=付ける, false=外す）"),
  },
  async ({ listName, reminderName, flagged }) => {
    const script = `
      tell application "Reminders"
        tell list "${listName}"
          set flagged of (first reminder whose name is "${reminderName}") to ${flagged}
        end tell
      end tell
    `;

    await runAppleScript(script);
    return {
      content: [
        {
          type: "text" as const,
          text: `リマインダー「${reminderName}」のフラグを${flagged ? "付けました" : "外しました"}`,
        },
      ],
    };
  }
);

// ----------------------------------------
// 9. 通知日時設定
// ----------------------------------------
server.tool(
  "set_remind_date",
  "リマインダーの通知日時を設定",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
    remindDate: z.string().describe('通知日時（例: "2024-03-15 17:00"）'),
  },
  async ({ listName, reminderName, remindDate }) => {
    const result = await runHelper([
      "set-remind-date",
      "--list", listName,
      "--reminder", reminderName,
      "--date", remindDate,
    ]);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ============================================================
// 新機能: 繰り返し（Issue #5）
// ============================================================

// ----------------------------------------
// 10. 繰り返しルール取得
// ----------------------------------------
server.tool(
  "get_recurrence",
  "リマインダーの繰り返しルールを取得",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
  },
  async ({ listName, reminderName }) => {
    const result = await runHelper([
      "get-recurrence",
      "--list", listName,
      "--reminder", reminderName,
    ]);
    return {
      content: [
        {
          type: "text" as const,
          text: result.message || JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ----------------------------------------
// 11. 繰り返しルール設定
// ----------------------------------------
server.tool(
  "set_recurrence",
  "リマインダーに繰り返しルールを設定（日次/週次/月次/年次）",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
    frequency: z
      .enum(["daily", "weekly", "monthly", "yearly"])
      .describe("頻度（daily=毎日, weekly=毎週, monthly=毎月, yearly=毎年）"),
    interval: z
      .number()
      .optional()
      .default(1)
      .describe("間隔（例: 2 → 2日ごと/2週ごと）"),
    endCount: z
      .number()
      .optional()
      .describe("終了回数（例: 10 → 10回で終了）"),
    endDate: z
      .string()
      .optional()
      .describe('終了日（例: "2024-12-31 23:59"）'),
  },
  async ({ listName, reminderName, frequency, interval, endCount, endDate }) => {
    const args = [
      "set-recurrence",
      "--list", listName,
      "--reminder", reminderName,
      "--frequency", frequency,
      "--interval", String(interval),
    ];
    if (endCount !== undefined) args.push("--end-count", String(endCount));
    if (endDate) args.push("--end-date", endDate);

    const result = await runHelper(args);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ----------------------------------------
// 12. 繰り返しルール解除
// ----------------------------------------
server.tool(
  "clear_recurrence",
  "リマインダーの繰り返しルールを解除",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
  },
  async ({ listName, reminderName }) => {
    const result = await runHelper([
      "clear-recurrence",
      "--list", listName,
      "--reminder", reminderName,
    ]);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ============================================================
// 新機能: 場所（Issue #6）
// ============================================================

// ----------------------------------------
// 13. 場所情報取得
// ----------------------------------------
server.tool(
  "get_location",
  "リマインダーの場所情報を取得",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
  },
  async ({ listName, reminderName }) => {
    const result = await runHelper([
      "get-location",
      "--list", listName,
      "--reminder", reminderName,
    ]);
    return {
      content: [
        {
          type: "text" as const,
          text: result.message || JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ----------------------------------------
// 14. 場所ベースの通知設定
// ----------------------------------------
server.tool(
  "set_location",
  "リマインダーに場所ベースの通知を設定（到着時/出発時）",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
    title: z.string().describe("場所名（例: 職場）"),
    latitude: z.number().describe("緯度"),
    longitude: z.number().describe("経度"),
    radius: z.number().optional().default(100).describe("半径（メートル、デフォルト: 100）"),
    proximity: z
      .enum(["enter", "leave"])
      .optional()
      .default("enter")
      .describe("トリガー条件（enter=到着時, leave=出発時）"),
  },
  async ({ listName, reminderName, title, latitude, longitude, radius, proximity }) => {
    const result = await runHelper([
      "set-location",
      "--list", listName,
      "--reminder", reminderName,
      "--title", title,
      "--latitude", String(latitude),
      "--longitude", String(longitude),
      "--radius", String(radius),
      "--proximity", proximity,
    ]);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ----------------------------------------
// 15. 場所ベースの通知解除
// ----------------------------------------
server.tool(
  "clear_location",
  "リマインダーの場所ベース通知を解除",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
  },
  async ({ listName, reminderName }) => {
    const result = await runHelper([
      "clear-location",
      "--list", listName,
      "--reminder", reminderName,
    ]);
    return {
      content: [{ type: "text" as const, text: result.message }],
    };
  }
);

// ============================================================
// サーバー起動
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[apple-reminders-mcp] サーバー起動完了 (v2.0.0 - EventKit backend)");
}

main().catch(console.error);
