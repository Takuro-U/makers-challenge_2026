import { requireOneOf } from '../lib/env.js';

const name = requireOneOf('LLM_PROVIDER', ['claude', 'openai']);

/**
 * 環境変数 LLM_PROVIDER で選んだプロバイダ。
 * 選ばれた側だけを読み込むため、もう一方の API キーは要求されない。
 * どちらも buildRequest / send / extractText を公開する。
 */
export const provider = await import(`./providers/${name}.js`);
