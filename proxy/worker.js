/**
 * Cloudflare Worker — OpenAI Responses API プロキシ
 * 「人流アノマリー要因分析」アプリ用（方式B：キーはサーバー側で保持）
 *
 * 役割:
 *  - OpenAI APIキーをサーバー側（環境変数 OPENAI_API_KEY）で保持し、外部に出さない
 *  - 合言葉（環境変数 APP_PASSWORD）を x-app-password ヘッダで検証
 *  - CORS を許可（環境変数 ALLOWED_ORIGIN。未設定なら "*"）
 *  - 任意: 1日あたりの利用回数制限（環境変数 DAILY_LIMIT + KVバインディング RL）
 *  - OpenAI のSSEストリームをそのまま中継（レスポンスを逐次転送）
 *
 * 必要な環境変数（Cloudflareダッシュボード → Settings → Variables and Secrets）:
 *  - OPENAI_API_KEY   … OpenAIのAPIキー（Secret推奨）
 *  - APP_PASSWORD     … 利用者に共有する合言葉（Secret推奨）
 *  - ALLOWED_ORIGIN   … 例: https://showg1005.github.io（省略時は "*"）
 *  - DAILY_LIMIT      … 例: "30"（省略/0ならレート制限なし。KVバインド RL も必要）
 */

const OPENAI_URL = 'https://api.openai.com/v1/responses';

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-app-password',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    // CORS プリフライト
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405, cors);

    // サーバー設定チェック
    if (!env.OPENAI_API_KEY) return json({ error: { message: 'サーバー未設定: OPENAI_API_KEY がありません。' } }, 500, cors);
    if (!env.APP_PASSWORD)   return json({ error: { message: 'サーバー未設定: APP_PASSWORD がありません。' } }, 500, cors);

    // 合言葉の検証
    const pass = request.headers.get('x-app-password') || '';
    if (pass !== env.APP_PASSWORD) {
      return json({ error: { message: '認証に失敗しました（合言葉が違います）。' } }, 401, cors);
    }

    // 任意: 日次レート制限（KV "RL" と DAILY_LIMIT が両方あるときのみ有効）
    if (env.RL && env.DAILY_LIMIT) {
      const limit = parseInt(env.DAILY_LIMIT, 10) || 0;
      if (limit > 0) {
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const day = new Date().toISOString().slice(0, 10); // Workerランタイムでは Date 利用可
        const key = `rl:${day}:${ip}`;
        const cur = parseInt((await env.RL.get(key)) || '0', 10);
        if (cur >= limit) {
          return json({ error: { message: `本日の利用上限（${limit}回）に達しました。` } }, 429, cors);
        }
        await env.RL.put(key, String(cur + 1), { expirationTtl: 172800 }); // 約2日でTTL失効
      }
    }

    // リクエストボディ（Responses API 形式）をそのまま OpenAI へ転送
    const bodyText = await request.text();

    let upstream;
    try {
      upstream = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + env.OPENAI_API_KEY
        },
        body: bodyText
      });
    } catch (e) {
      return json({ error: { message: 'OpenAIへの転送に失敗しました: ' + (e && e.message || e) } }, 502, cors);
    }

    // ステータスと content-type を維持したままストリームを中継
    const headers = new Headers(cors);
    const ct = upstream.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'content-type': 'application/json' }, cors)
  });
}
