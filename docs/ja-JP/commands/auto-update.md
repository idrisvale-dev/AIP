---
description: 最新のAIPリポジトリ変更をプルし、現在の管理対象ターゲットを再インストールします。
disable-model-invocation: true
---

# 自動更新

AIPをアップストリームリポジトリから更新し、元のインストール状態リクエストを使用して現在のコンテキストの管理対象インストールを再生成します。

## 使い方

```bash
# 何も変更せずに更新をプレビュー
AIP_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=p.join(o.homedir(),'.claude');function L(x){try{return require(p.join(x,'scripts','lib','resolve-aip-root')).resolveAipRoot({probe:p.join('scripts','auto-update.js')})}catch(_){return null}}var r=L(d);if(r)return r;var s=['aip','aip@aip','marketplaces/aip','aip','aip@aip','marketplaces/aip'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}try{var g=['aip','aip'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=f.readdirSync(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=f.readdirSync(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}}catch(_){}return d})();console.log(r)")}"
node "$AIP_ROOT/scripts/auto-update.js" --dry-run

# 現在のプロジェクトのCursor管理ファイルのみ更新
node "$AIP_ROOT/scripts/auto-update.js" --target cursor

# AIPリポジトリルートを明示的に上書き
node "$AIP_ROOT/scripts/auto-update.js" --repo-root /path/to/aip
```

## ノート

- このコマンドは記録されたインストール状態リクエストを使用し、最新のリポジトリ変更をプルした後に`install-apply.js`を再実行します。
- 再インストールは意図的です: `repair.js`が古い操作から安全に再構築できないアップストリームの名前変更や削除を処理します。
- 何も変更する前に再構築された再インストール計画を確認したい場合は、先に`--dry-run`を使用してください。
