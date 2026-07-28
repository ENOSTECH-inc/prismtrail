# BigQuery Data Agent Eval

[English](./README.md) · [アーキテクチャ](./ARCHITECTURE.md) · [セキュリティ](./SECURITY.md) · [コントリビューション](./CONTRIBUTING.md)

> 既存のBigQuery Data Agentを対象に、ローカルで回帰テスト・精度評価・Google Sheets
> レポーティングを行う評価基盤です。

BigQuery Data Agent Evalは、繰り返し確認したい実業務の質問をテストスイートとして管理し、
Data AgentのレスポンストレースとBigQuery Job情報を取得します。動作の健全性とビジネス上の
正確性を分けて評価し、Web UIとGoogle Sheetsへ共有しやすいレポートを出力します。

ローカルPCとコーディングエージェントでの利用を想定しています。認証にはApplication
Default Credentials（ADC）を使用し、アクセストークンや認証情報をリポジトリやブラウザへ
保存しません。

> [!IMPORTANT]
> 本プロジェクトはGoogle公式製品ではない独立したOSSです。BigQuery Data Agentおよび関連API
> には提供地域、権限、割り当て、料金などの条件があります。実行前に
> [Google Cloud公式ドキュメント](https://docs.cloud.google.com/bigquery/docs/create-data-agents?hl=ja)
> を確認してください。

## 評価する内容

| レイヤー | 主な判定内容 | 出力 |
|---|---|---|
| システム要件 | 最終回答、エラー、SQL、チャート、時間、課金バイト、必須語句 | 合否チェックとスコア |
| ビジネス要件 | 正解値、期間、単位、許容差、回答内の根拠 | GeminiによるA/B/C/D評価 |
| レポート | 進捗、トレース、コスト、スコア、根拠、エラー | Web UIと管理対象Google Sheet |

## 主な機能

- 単一プロンプト実行と正規化レスポンストレース
- ライブ進捗を表示する再利用可能なテストスイート
- システム要件とビジネス要件のスコア分離
- 根拠付きA/B/C/D精度評価
- 生成SQL、検証済みクエリ、BigQuery Query Jobを含むSQL証跡判定
- 実行時間とBigQuery課金対象バイトの集計
- 既存Data Agentのリソース名による登録
- Google Sheetsでのテストスイート入出力と評価レポート書き戻し
- GCSナレッジ、テキスト同期、簡易検索、根拠判定
- ローカルJSON／GCSの切り替え可能なプライマリーストレージ
- macOS、Windows、Linux対応のDocker Compose
- セットアップCLIとコーディングエージェント用スキル

## クイックスタート

### 必要なもの

- Docker Engine/DesktopとCompose
- Google Cloud CLI
- 既存BigQuery Data Agentを利用できるGoogle Cloudプロジェクト
- Data Agent、対象BigQueryデータ、Vertex AIへの権限
- GCS／Google Sheets機能を使う場合は各リソースへの権限
- セットアップCLIと開発にはNode.js 20以上

### 1. インストール

```bash
git clone https://github.com/ENOSTECH-inc/bigquery-data-agent-eval.git
cd bigquery-data-agent-eval
npm ci
```

### 2. `.env`を安全に作成

```bash
npm run setup -- init
```

非対話実行するコーディングエージェントでは、実在する値を明示します。

```bash
npm run setup -- init \
  --project your-google-cloud-project \
  --agent projects/your-google-cloud-project/locations/global/dataAgents/your-agent-id \
  --label "My Data Agent"
```

CLIは識別子を検証し、Git管理対象外の`.env`だけを書き込みます。トークンやサービスアカウント
キーは取得・保存しません。

### 3. ADCでログイン

```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets

gcloud auth application-default set-quota-project your-google-cloud-project
```

### 4. 診断して起動

```bash
npm run setup -- doctor
npm run setup -- up --detach
docker compose ps
```

[http://127.0.0.1:4318](http://127.0.0.1:4318) を開きます。Dockerの公開ポートは
既定でループバックインターフェースだけにバインドされます。

停止:

```bash
docker compose down
```

## セットアップCLI

```text
bq-agent-eval init     検証済みの.envを作成
bq-agent-eval doctor   Node、Docker、gcloud、ADC、設定を診断
bq-agent-eval up       Docker Composeをビルドして起動
bq-agent-eval skill    同梱エージェントスキルのパスを表示
```

グローバルインストールは不要です。`npm run setup -- <command>`で利用できます。

## コーディングエージェント用スキル

[`skills/bq-data-agent-eval/SKILL.md`](./skills/bq-data-agent-eval/SKILL.md) に、セットアップ、
認証、機密データの扱い、評価条件、Google Sheets/GCS操作、コード変更時の検証手順をまとめています。

Codexではスキルディレクトリを`~/.codex/skills/`へコピーまたはシンボリックリンクできます。
ほかのコーディングエージェントでも、作業前にこのファイルを読むよう指定してください。

## 基本フロー

1. 既存Data Agentを完全なリソース名で登録
2. アプリまたは管理対象Google Sheetでテストスイートを作成
3. システム要件と、必要に応じて自然言語のビジネス要件を設定
4. スイートを実行し、ケースごとの進捗を確認
5. トレース、SQL／Job証跡、スコア、コスト、精度判定理由を確認
6. `AgentEval_Report`を共有

### ビジネス要件

期待する値、対象期間、単位、許容差を自然言語で記述します。Vertex AIの判定モデルがData
Agentの回答と構造化結果を照合します。

- **A**: 完全一致
- **B**: おおむね正しい
- **C**: 一部不一致
- **D**: 不一致

既定ではA/Bを合格とします。判定モデル側の障害はDにせず「要確認」として扱います。

## Google Sheets

ADCのユーザーへ共有したスプレッドシートをアプリから接続します。アプリが管理するタブは
次の2つだけです。

- `AgentEval_TestSuite`: スイート情報と最大50件のテストケース
- `AgentEval_Report`: スイート実行結果とケース別評価

固定タブはシートIDを維持したまま再描画します。ユーザー作成タブは変更しません。取り込み値は
サーバー側で再検証し、非表示列や貼り付け内容を信頼しません。

## ストレージ

- **ローカルJSON**: 単一PCでの開発
- **Google Cloud Storage**: バケット／prefix配下でのポータブルな共有

GCS更新ではgeneration条件を使用し、古いクライアントによる上書きを防ぎます。移行はコピーと
検証後に切り替え、移行元を削除しません。

## セキュリティ境界

本アプリは信頼済みローカルツールです。

- アプリケーション独自のユーザー認証はありません
- Dockerの公開先は既定で`127.0.0.1`のみです
- ADCはread-onlyでマウントし、トークンはプロセスメモリ内だけで扱います
- `.env`、runtime `data/`、トレース、シート接続、画像はGit管理対象外です
- 入力サイズと各種識別子をサーバー側で検証します
- セキュリティヘッダーとContent Security Policyを設定します

現状のままLANやインターネットへ公開しないでください。チーム向けホスティングには、TLS、
Identity-Aware Proxy等の認証、Workload Identity、認可、テナント分離が必要です。
[SECURITY.md](./SECURITY.md)も確認してください。

## 開発

```bash
npm ci
npm test
npm audit --omit=dev --audit-level=high
docker compose build
```

詳細は[CONTRIBUTING.md](./CONTRIBUTING.md)と[ARCHITECTURE.md](./ARCHITECTURE.md)を参照してください。

## 参考にしたOSS

本プロジェクトはBigQuery Data Agentに特化した独立実装です。評価基盤の説明や設計上の観点は
以下のOSSを参考にしています。

- [promptfoo](https://github.com/promptfoo/promptfoo)
- [DeepEval](https://github.com/confident-ai/deepeval)
- [Arize Phoenix](https://github.com/Arize-ai/phoenix)

これらのプロジェクトのソースコードは含みません。

## ライセンス

Apache License 2.0です。[LICENSE](./LICENSE)、[NOTICE](./NOTICE)、
[サードパーティ表記](./THIRD_PARTY_NOTICES.md)を参照してください。

Copyright 2026 ENOSTECH, Inc.
