import Anthropic from '@anthropic-ai/sdk';
import { requireEnv } from '../lib/env.js';

const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });

/**
 * 反論リクエストを Claude API へ 1 回だけ送り、完了した応答(Message)を返す。
 * Web 検索と思考で応答に時間がかかるため、タイムアウトを避けてストリーミングで受ける。
 * 応答が pause_turn で止まっても再開のリクエストは送らない。
 * @param {object} request buildRebuttalRequest() が組み立てたリクエスト本文
 */
export function sendRebuttalRequest(request) {
  return client.messages.stream(request).finalMessage();
}
