/**
 * apple-reminders-mcp
 *
 * macOS Reminders.appを操作するMCPサーバー
 * osascript（AppleScript）を使ってReminders.appと通信する
 *
 * 【MCPとは？】
 * Model Context Protocol の略。
 * Claude等のAIがツール（機能）を呼び出すための通信規約。
 * このサーバーは「リマインダー操作」というツールをClaudeに提供する。
 *
 * 【動作の流れ】
 * 1. Claude Code/Desktop がこのサーバーを起動
 * 2. サーバーは「こんなツールがあるよ」とClaudeに伝える
 * 3. Claudeがツールを呼び出す（例: list_reminder_lists）
 * 4. サーバーがosascriptを実行してReminders.appを操作
 * 5. 結果をClaudeに返す
 */

// ============================================================
// ライブラリの読み込み（import）
// ============================================================

// MCP SDKからサーバー機能を読み込む
// McpServer: MCPサーバーの本体。ツールを登録したり、Claudeと通信したりする
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// StdioServerTransport: 標準入出力（stdin/stdout）で通信するためのもの
// Claudeはこのサーバーとstdin/stdoutでJSON-RPCメッセージをやり取りする
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// zod: 入力値の検証ライブラリ
// ツールに渡されるパラメータが正しい型かチェックする
// 例: z.string() → 文字列でないとエラー
import { z } from "zod";

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * osascriptを実行するヘルパー関数
 *
 * 【osascriptとは？】
 * macOSに標準搭載されているコマンド。
 * AppleScript（macOSアプリを自動操作するスクリプト言語）を実行する。
 *
 * 例: osascript -e 'tell application "Reminders" to get name of every list'
 * → Reminders.appに「全リストの名前を教えて」と指示
 *
 * @param script - 実行するAppleScriptの文字列
 * @returns 実行結果（文字列）
 */
async function runAppleScript(script: string): Promise<string> {
  // Bun.spawn: 外部コマンドを実行する（Node.jsのchild_process.spawnに相当）
  // ["osascript", "-e", script] → `osascript -e "script内容"` を実行
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe", // 標準出力をパイプで受け取る（結果を取得するため）
    stderr: "pipe", // 標準エラー出力もパイプで受け取る（エラーメッセージ取得のため）
  });

  // 実行結果を取得
  const stdout = await new Response(proc.stdout).text(); // 正常な出力
  const stderr = await new Response(proc.stderr).text(); // エラー出力
  const exitCode = await proc.exited; // 終了コード（0=成功、それ以外=失敗）

  // エラーチェック
  if (exitCode !== 0) {
    throw new Error(`AppleScript error: ${stderr}`);
  }

  // 結果を返す（前後の空白を削除）
  return stdout.trim();
}

// ============================================================
// MCPサーバーの作成
// ============================================================

/**
 * MCPサーバーのインスタンスを作成
 *
 * name: サーバーの識別名（Claudeに表示される）
 * version: バージョン番号
 */
const server = new McpServer({
  name: "apple-reminders-mcp",
  version: "1.0.0",
});

// ============================================================
// ツールの登録
// ============================================================

/**
 * 【server.tool() の構造】
 *
 * server.tool(
 *   "ツール名",           // Claudeが呼び出すときの名前
 *   "ツールの説明",       // Claudeがツールを選ぶときの参考情報
 *   { パラメータ定義 },   // ツールに渡せる引数（zodで型を定義）
 *   async (params) => { } // 実際の処理（非同期関数）
 * )
 *
 * 戻り値の形式:
 * {
 *   content: [
 *     { type: "text", text: "結果のテキスト" }
 *   ]
 * }
 */

// ----------------------------------------
// 1. リスト一覧取得
// ----------------------------------------
server.tool(
  "list_reminder_lists",
  "リマインダーのリスト一覧を取得",
  {}, // パラメータなし
  async () => {
    // AppleScript: Reminders.appに「全リストの名前を取得」と指示
    const script = 'tell application "Reminders" to get name of every list';
    const result = await runAppleScript(script);

    // AppleScriptの結果は "list1, list2, list3" 形式なのでカンマで分割
    const lists = result.split(", ");

    // MCPの戻り値形式で返す
    return {
      content: [
        {
          type: "text" as const, // TypeScriptの型推論のためのキャスト
          text: JSON.stringify(lists, null, 2), // 見やすいJSON形式に変換
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
    // z.string(): 文字列型
    // .describe(): Claudeへのパラメータ説明
    listName: z.string().describe("リスト名"),

    // z.boolean(): 真偽値型
    // .optional(): 省略可能
    // .default(false): 省略時のデフォルト値
    includeCompleted: z
      .boolean()
      .optional()
      .default(false)
      .describe("完了済みも含めるか"),
  },
  async ({ listName, includeCompleted }) => {
    // 完了済みを含めるかどうかでフィルター条件を変える
    const filter = includeCompleted ? "" : " whose completed is false";

    // AppleScript: リマインダーの詳細情報を取得
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
      // 期日がないリマインダーがあるとエラーになることがあるので
      // シンプルに名前だけ取得するフォールバック
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
    // AppleScriptのプロパティ文字列を組み立てる
    let properties = `name:"${title}"`;
    if (body) {
      properties += `, body:"${body}"`;
    }
    if (dueDate) {
      properties += `, due date:date "${dueDate}"`;
    }

    // AppleScript: 新しいリマインダーを作成
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
    // AppleScript: 指定した名前のリマインダーを完了に設定
    // "first reminder whose name is ..." で名前で検索
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
    // AppleScript: 指定した名前のリマインダーを削除
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
    // 更新するAppleScriptコマンドを配列に集める
    const updates: string[] = [];

    if (newName) {
      updates.push(`set name of r to "${newName}"`);
    }
    if (newBody) {
      updates.push(`set body of r to "${newBody}"`);
    }
    if (appendBody) {
      // 既存のbodyに追記（& は文字列連結）
      updates.push(`set body of r to (body of r) & "\n${appendBody}"`);
    }
    if (newDueDate) {
      updates.push(`set due date of r to date "${newDueDate}"`);
    }

    // 何も更新項目がない場合は早期リターン
    if (updates.length === 0) {
      return {
        content: [{ type: "text" as const, text: "更新する項目が指定されていません" }],
      };
    }

    // AppleScript: リマインダーを取得して更新
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

// ----------------------------------------
// 7. 優先度設定
// ----------------------------------------
server.tool(
  "set_priority",
  "リマインダーの優先度を設定（0=なし, 1=高, 5=中, 9=低）",
  {
    listName: z.string().describe("リスト名"),
    reminderName: z.string().describe("リマインダー名"),
    // z.number(): 数値型
    // .min(0).max(9): 0〜9の範囲
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

    // 数値を日本語ラベルに変換（ユーザーにわかりやすく）
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

// ----------------------------------------
// 8. フラグ設定
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

// ============================================================
// サーバー起動
// ============================================================

/**
 * サーバーを起動するメイン関数
 *
 * 【何をしている？】
 * 1. StdioServerTransport を作成
 *    → stdin/stdout で通信する準備
 *
 * 2. server.connect(transport) を呼び出し
 *    → サーバーを起動し、Claudeからの接続を待機
 *    → 「このサーバーにはこんなツールがあるよ」とClaudeに伝える
 *
 * 3. console.error でログ出力
 *    → console.log ではなく console.error を使う理由:
 *       stdout はClaudeとの通信に使われるため、
 *       ログは stderr に出力する必要がある
 *
 * 【「呼び出す」とは？】
 * このファイルを `bun src/index.ts` で実行すると:
 * 1. main() が呼ばれる
 * 2. サーバーが起動し、待機状態になる
 * 3. Claudeがstdinにメッセージを送ると、サーバーが処理してstdoutに返す
 */
async function main() {
  // 標準入出力（stdin/stdout）で通信するトランスポートを作成
  const transport = new StdioServerTransport();

  // サーバーをトランスポートに接続（起動）
  // この時点でClaudeからの接続を待機する状態になる
  await server.connect(transport);

  // 起動完了のログ（stderrに出力）
  console.error("[apple-reminders-mcp] サーバー起動完了");
}

// main() を実行し、エラーがあればコンソールに出力
// .catch(console.error) はエラーハンドリングのおまじない
main().catch(console.error);
