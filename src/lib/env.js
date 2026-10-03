// 環境変数の読み取り。必須の値が未設定・不正な場合は起動を中止する

/** 起動時の設定エラーを出力して起動を中止する */
export function failStartup(message) {
  console.error(message);
  process.exit(1);
}

/** 必須の文字列。未設定(空文字を含む)なら起動を中止する */
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) failStartup(`環境変数 ${name} が未設定です`);
  return value;
}

/** 必須の正の整数 */
export function requirePositiveInt(name) {
  const raw = requireEnv(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    failStartup(`環境変数 ${name} は正の整数で指定してください(現在: ${raw})`);
  }
  return value;
}

/** 必須の数値。min 以上 max 以下 */
export function requireNumberInRange(name, min, max) {
  const raw = requireEnv(name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    failStartup(`環境変数 ${name} は ${min} 以上 ${max} 以下の数値で指定してください(現在: ${raw})`);
  }
  return value;
}

/** 必須の列挙値 */
export function requireOneOf(name, allowed) {
  const value = requireEnv(name);
  if (!allowed.includes(value)) {
    failStartup(`環境変数 ${name} は ${allowed.join(' / ')} のいずれかで指定してください(現在: ${value})`);
  }
  return value;
}
