# プロキシ（Cloudflare Workers）セットアップ

「人流アノマリー要因分析」アプリを **方式B（配布・共有用）** で動かすためのプロキシです。
OpenAI APIキーを**サーバー側で保持**し、利用者は**合言葉（パスワード）だけ**でアプリを使えます。
公開URL（GitHub Pages 等）からの **CORS 問題も解消**します。

```
[利用者のブラウザ/PWA]  --(合言葉)-->  [Cloudflare Worker]  --(OpenAIキー)-->  [OpenAI API]
```

---

## 事前準備

- **Cloudflare アカウント**（無料枠でOK）
- **OpenAI APIキー**（`platform.openai.com/api-keys`）
- 利用者に配る **合言葉**（任意の文字列。長め・推測されにくいものを推奨）

> 💰 費用は「あなたのOpenAI利用料」として発生します。OpenAI側で **Usage limits（月次上限）** を必ず設定してください（`platform.openai.com` → Settings → Limits）。Cloudflare Workers 自体は無料枠で十分です。

---

## 方法A: ダッシュボードで貼り付けデプロイ（最も簡単・CLI不要）

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker**
2. 名前を付けて **Deploy**（雛形が作られる）→ **Edit code**
3. 本リポジトリの [`proxy/worker.js`](./worker.js) の内容を**全部貼り付け**て **Deploy**
4. Worker の **Settings → Variables and Secrets** で以下を追加：
   | 名前 | 種別 | 値 |
   |---|---|---|
   | `OPENAI_API_KEY` | Secret | あなたのOpenAIキー（`sk-...`） |
   | `APP_PASSWORD` | Secret | 利用者に配る合言葉 |
   | `ALLOWED_ORIGIN` | Text | アプリの公開オリジン（例 `https://showg1005.github.io`）|
   | `DAILY_LIMIT` | Text | （任意）1人あたり日次上限。例 `30`。使うなら下のKVも必要 |
5. （任意・レート制限）**Storage & Databases → KV** で namespace を作成 → Worker の **Settings → Bindings** で **KV namespace** を追加し、変数名 **`RL`** でバインド
6. デプロイされた URL（例 `https://ggai-openai-proxy.<あなた>.workers.dev`）を控える

## 方法B: wrangler CLI

```bash
cd proxy
npm i -g wrangler
wrangler login
wrangler secret put OPENAI_API_KEY   # プロンプトにキーを貼り付け
wrangler secret put APP_PASSWORD      # 合言葉を貼り付け
# wrangler.toml の ALLOWED_ORIGIN を自分の公開オリジンに編集
wrangler deploy
```

出力される `https://....workers.dev` が Worker のURLです。

---

## アプリ側の設定

デプロイした Worker URL を、アプリの利用者に使ってもらう方法は2通り：

- **推奨：URLを埋め込む** — `index.html` の先頭付近にある
  ```js
  const PROXY_URL = '';
  ```
  を、あなたの Worker URL に書き換えてコミット／プッシュ：
  ```js
  const PROXY_URL = 'https://ggai-openai-proxy.xxxx.workers.dev';
  ```
  こうすると利用者は **合言葉を入力するだけ**（URL入力不要）で使えます。

- **URLを埋め込まない場合** — 利用者がアプリの「API設定 → プロキシ経由」で、
  **プロキシURL** と **合言葉** を入力します。

いずれの場合も、利用者に配るのは **アプリのURL** と **合言葉** の2つだけです。

---

## 動作確認（任意）

```bash
# 認証エラー（合言葉なし）→ 401 が返れば疎通OK
curl -i -X POST "https://<your-worker>.workers.dev" \
  -H "content-type: application/json" -d '{}'

# 正しい合言葉での最小リクエスト（ストリーム）
curl -N -X POST "https://<your-worker>.workers.dev" \
  -H "content-type: application/json" \
  -H "x-app-password: <合言葉>" \
  -d '{"model":"gpt-5.6","input":"ping","tools":[{"type":"web_search"}],"stream":true}'
```

---

## セキュリティ notes

- `ALLOWED_ORIGIN` は **アプリの公開オリジンに限定**するのを推奨（`*` は誰でも呼べます）。ただしブラウザCORSは万能ではないので、**合言葉と OpenAI 側の月次上限が本質的な防御**です。
- 合言葉が漏れた場合は `APP_PASSWORD` を更新すれば全員無効化できます（利用者へ新しい合言葉を再配布）。
- レート制限（`DAILY_LIMIT` + KV `RL`）は IP 単位の簡易的なものです。厳密な per-user 制御が必要なら、合言葉を利用者ごとに分ける運用も可能です。
