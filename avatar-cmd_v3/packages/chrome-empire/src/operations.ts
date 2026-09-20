// ================================================
// BrowserOperation の実行
// ================================================
// integrations の Provider は getPostSteps() / getLoginSteps() で
// 操作列（BrowserOperation[]）を返すが、それを実行する側が存在せず、
// pool.executeTask の post / login / engage はナビゲートするだけの
// スタブになっていた。ここでその橋渡しを行う。
//
// セレクタと入力値は Provider が提供する。ここでは
// 「開く → 待つ → 埋める → 押す → 読む」という汎用手順だけを解釈する。

import type { Page } from "playwright";

export interface OperationStep {
  action:
    | "login"
    | "post"
    | "read"
    | "engage"
    | "collect_metrics"
    | "search"
    | "navigate";
  url: string;
  selectors?: Record<string, string>;
  inputData?: Record<string, string>;
  confirmationUrlPattern?: string;
  waitFor?: string;
  timeout?: number;
}

export interface OperationStepResult {
  action: OperationStep["action"];
  url: string;
  success: boolean;
  error?: string;
  /** read / collect_metrics で取得したテキスト */
  items?: string[];
  /** post / engage で押したセレクタ */
  submitted?: string;
}

/** 押下ボタンとして扱うセレクタキー（Provider 側の命名に合わせる） */
const SUBMIT_KEYS = ["submit", "post", "send", "tweet", "publish"];
/** 一覧取得として扱うセレクタキー */
const ITEMS_KEYS = ["items", "results", "list"];
/** 本文入力として扱うセレクタキー */
const EDITOR_KEYS = ["editor", "body", "text", "content", "textarea"];

function pick(
  selectors: Record<string, string> | undefined,
  keys: string[],
): { key: string; selector: string } | null {
  if (!selectors) return null;
  for (const key of keys) {
    if (selectors[key]) return { key, selector: selectors[key] };
  }
  return null;
}

/**
 * 1 ステップを実行する。
 * inputData に値がある selectors のキーへ順に入力し、
 * submit 相当のセレクタがあれば押す。
 */
async function runStep(
  page: Page,
  step: OperationStep,
  defaultTimeout: number,
): Promise<OperationStepResult> {
  const timeout = step.timeout ?? defaultTimeout;
  const result: OperationStepResult = {
    action: step.action,
    url: step.url,
    success: false,
  };

  if (step.action === "post" && !step.confirmationUrlPattern)
    throw new Error("公開確認URLの定義がありません");
  await page.goto(step.url, { timeout, waitUntil: "domcontentloaded" });

  if (step.waitFor) {
    await page.waitForSelector(step.waitFor, { timeout });
  }

  const selectors = step.selectors ?? {};
  const inputData = step.inputData ?? {};
  const submit = pick(selectors, SUBMIT_KEYS);
  const items = pick(selectors, ITEMS_KEYS);

  // 入力: inputData のキーに対応するセレクタへ値を入れる。
  // 本文系はリッチエディタ（contenteditable）のことがあるため fill が
  // 失敗したら type にフォールバックする。
  for (const [key, value] of Object.entries(inputData)) {
    const selector = selectors[key] ?? pick(selectors, EDITOR_KEYS)?.selector;
    if (!selector) continue;

    const locator = page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout });
    try {
      await locator.fill(value, { timeout });
    } catch {
      await locator.click({ timeout });
      await locator.type(value, { timeout });
    }
  }

  if (items) {
    const texts = await page.locator(items.selector).allInnerTexts();
    result.items = texts
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  if (submit && step.action !== "read" && step.action !== "search") {
    await page.locator(submit.selector).first().click({ timeout });
    if (step.action === "post") {
      const pattern = new RegExp(step.confirmationUrlPattern!);
      await page.waitForURL((url) => pattern.test(url.href), { timeout });
    }
    result.submitted = submit.selector;
  }

  result.url = page.url();
  result.success = true;
  return result;
}

export interface OperationsResult {
  success: boolean;
  steps: OperationStepResult[];
  error?: string;
}

/**
 * 操作列を順に実行する。1 つ失敗した時点で中断する
 * （ログイン→投稿のように前段に依存するため）。
 */
export async function executeOperations(
  page: Page,
  operations: OperationStep[],
  defaultTimeout: number,
): Promise<OperationsResult> {
  const steps: OperationStepResult[] = [];

  for (const [index, step] of operations.entries()) {
    try {
      steps.push(await runStep(page, step, defaultTimeout));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({
        action: step.action,
        url: step.url,
        success: false,
        error: message,
      });
      return {
        success: false,
        steps,
        error: `step ${index + 1}/${operations.length} (${step.action}) failed: ${message}`,
      };
    }
  }

  return { success: true, steps };
}
