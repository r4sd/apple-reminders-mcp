import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// osascriptを実行するヘルパー関数
async function runAppleScript(script: string): Promise<string> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`AppleScript error: ${stderr}`);
  }
  return stdout.trim();
}

// MCPサーバー作成
const server = new McpServer({
  name: "apple-reminders-mcp",
  version: "1.0.0",
});

// 1. リスト一覧取得
server.tool(
  "list_reminder_lists",
  "リマインダーのリスト一覧を取得",
  {},
  async () => {
    const script = 'tell application "Reminders" to get name of every list';
    const result = await runAppleScript(script);
    // AppleScriptの配列形式をパース: "list1, list2, list3"
    const lists = result.split(", ");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(lists, null, 2),
        },
      ],
    };
  }
);

// 2. 特定リストのリマインダー一覧取得
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
    // 完了済みを含めるかどうかでスクリプトを変える
    const filter = includeCompleted ? "" : " whose completed is false";
    const script = `
      tell application "Reminders"
        set myList to list "${listName}"
        set reminderData to {}
        repeat with r in (every reminder of myList${filter})
          set end of reminderData to {|name|:name of r, |body|:body of r, |completed|:completed of r, |dueDate|:due date of r}
        end repeat
        return reminderData
      end tell
    `;

    try {
      const result = await runAppleScript(script);
      return {
        content: [
          {
            type: "text" as const,
            text: result || "リマインダーがありません",
          },
        ],
      };
    } catch (error) {
      // リマインダーがない場合や期日がない場合のエラーをハンドル
      const simpleScript = `
        tell application "Reminders"
          set myList to list "${listName}"
          get name of every reminder of myList${filter}
        end tell
      `;
      const result = await runAppleScript(simpleScript);
      const reminders = result ? result.split(", ") : [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(reminders, null, 2),
          },
        ],
      };
    }
  }
);

// 3. リマインダー追加
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
    let properties = `name:"${title}"`;
    if (body) {
      properties += `, body:"${body}"`;
    }
    if (dueDate) {
      properties += `, due date:date "${dueDate}"`;
    }

    const script = `
      tell application "Reminders"
        tell list "${listName}"
          make new reminder with properties {${properties}}
        end tell
      end tell
    `;

    await runAppleScript(script);
    return {
      content: [
        {
          type: "text" as const,
          text: `リマインダー「${title}」を「${listName}」に追加しました`,
        },
      ],
    };
  }
);

// 4. リマインダー完了
server.tool(
  "complete_reminder",
  "リマインダーを完了にする",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
  },
  async ({ listName, reminderName }) => {
    const script = `
      tell application "Reminders"
        tell list "${listName}"
          set completed of (first reminder whose name is "${reminderName}") to true
        end tell
      end tell
    `;

    await runAppleScript(script);
    return {
      content: [
        {
          type: "text" as const,
          text: `リマインダー「${reminderName}」を完了にしました`,
        },
      ],
    };
  }
);

// 5. リマインダー削除
server.tool(
  "delete_reminder",
  "リマインダーを削除",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("削除するリマインダー名"),
  },
  async ({ listName, reminderName }) => {
    const script = `
      tell application "Reminders"
        tell list "${listName}"
          delete (first reminder whose name is "${reminderName}")
        end tell
      end tell
    `;

    await runAppleScript(script);
    return {
      content: [
        {
          type: "text" as const,
          text: `リマインダー「${reminderName}」を削除しました`,
        },
      ],
    };
  }
);

// 6. リマインダー更新
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
    const updates: string[] = [];

    if (newName) {
      updates.push(`set name of r to "${newName}"`);
    }
    if (newBody) {
      updates.push(`set body of r to "${newBody}"`);
    }
    if (appendBody) {
      updates.push(`set body of r to (body of r) & "\n${appendBody}"`);
    }
    if (newDueDate) {
      updates.push(`set due date of r to date "${newDueDate}"`);
    }

    if (updates.length === 0) {
      return {
        content: [{ type: "text" as const, text: "更新する項目が指定されていません" }],
      };
    }

    const script = `
      tell application "Reminders"
        tell list "${listName}"
          set r to (first reminder whose name is "${reminderName}")
          ${updates.join("\n          ")}
        end tell
      end tell
    `;

    await runAppleScript(script);
    return {
      content: [
        {
          type: "text" as const,
          text: `リマインダー「${reminderName}」を更新しました`,
        },
      ],
    };
  }
);

// 7. 優先度設定
server.tool(
  "set_priority",
  "リマインダーの優先度を設定（0=なし, 1=高, 5=中, 9=低）",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
    priority: z.number().min(0).max(9).describe("優先度（0=なし, 1=高, 5=中, 9=低）"),
  },
  async ({ listName, reminderName, priority }) => {
    const script = `
      tell application "Reminders"
        tell list "${listName}"
          set priority of (first reminder whose name is "${reminderName}") to ${priority}
        end tell
      end tell
    `;

    await runAppleScript(script);
    const priorityLabel = priority === 0 ? "なし" : priority <= 3 ? "高" : priority <= 6 ? "中" : "低";
    return {
      content: [
        {
          type: "text" as const,
          text: `リマインダー「${reminderName}」の優先度を「${priorityLabel}」に設定しました`,
        },
      ],
    };
  }
);

// 8. フラグ設定
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

// 9. 通知日時設定
server.tool(
  "set_remind_date",
  "リマインダーの通知日時を設定",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
    remindDate: z.string().describe('通知日時（例: "2024-03-15 17:00"）'),
  },
  async ({ listName, reminderName, remindDate }) => {
    const script = `
      tell application "Reminders"
        tell list "${listName}"
          set remind me date of (first reminder whose name is "${reminderName}") to date "${remindDate}"
        end tell
      end tell
    `;

    await runAppleScript(script);
    return {
      content: [
        {
          type: "text" as const,
          text: `リマインダー「${reminderName}」の通知日時を「${remindDate}」に設定しました`,
        },
      ],
    };
  }
);

// サーバー起動
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[apple-reminders-mcp] サーバー起動完了");
}

main().catch(console.error);
