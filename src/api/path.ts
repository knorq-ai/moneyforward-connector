/**
 * URL パスに埋め込む ID を検証してエスケープする。
 *
 * テンプレートリテラルに ID をそのまま差し込むと、`123/disapprove#` のような値で
 * 別のエンドポイントへリクエストが飛ぶ（fragment は送信されないため、末尾の
 * `/approve` が切り落とされて `/disapprove` に到達する）。実際に承認ツールの
 * 呼び出しが却下を実行できてしまうため、パスに入る値は必ずここを通す。
 *
 * MF の ID は数値・UUID・英数字の混在がありうるので、許可するのは
 * 英数字・ハイフン・アンダースコアのみとする。スラッシュ・ドット・`#`・`?`・
 * 空文字はすべて拒否する。
 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ID_LENGTH = 128;

export function pathParam(value: string, name = 'id'): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} は文字列で指定してください`);
  }
  if (value.length === 0) {
    throw new Error(`${name} が空です`);
  }
  if (value.length > MAX_ID_LENGTH) {
    throw new Error(`${name} が長すぎます（最大 ${MAX_ID_LENGTH} 文字）`);
  }
  if (!ID_PATTERN.test(value)) {
    throw new Error(
      `${name} の形式が不正です: 英数字・ハイフン・アンダースコアのみ使用できます`
        + `（スラッシュやドットを含む値は別エンドポイントへのリクエストになり得るため拒否します）`
    );
  }
  // パターン上はエスケープ不要だが、将来パターンを緩めたときの保険として必ず通す。
  return encodeURIComponent(value);
}
