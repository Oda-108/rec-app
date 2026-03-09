#!/bin/bash
cd "$(dirname "$0")"

# Node.jsチェック
if ! command -v node &> /dev/null; then
  echo ""
  echo "  Node.js が見つかりません"
  echo "  https://nodejs.org からインストールしてください"
  echo ""
  read -p "Enterで終了..."
  exit 1
fi

# 初回のみ依存パッケージをインストール
if [ ! -d "node_modules" ]; then
  echo "初回セットアップ中..."
  npm install
fi

echo ""
echo "  Rec を起動中..."
echo "  ブラウザで http://localhost:3456 を開いてください"
echo ""

# ブラウザを自動で開く
open http://localhost:3456 2>/dev/null || true

npm start
