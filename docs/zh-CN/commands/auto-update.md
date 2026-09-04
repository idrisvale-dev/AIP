---
description: 拉取最新的AIP仓库更改并重新安装当前管理的目标。
disable-model-invocation: true
---

# 自动更新

从其上游仓库更新 AIP，并使用原始的安装状态请求重新生成当前上下文的受管安装。

## 用法

```bash
# Preview the update without mutating anything
AIP_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=p.join(o.homedir(),'.claude');function L(x){try{return require(p.join(x,'scripts','lib','resolve-aip-root')).resolveAipRoot({probe:p.join('scripts','auto-update.js')})}catch(_){return null}}var r=L(d);if(r)return r;var s=['aip','aip@aip','marketplaces/aip','aip','aip@aip','marketplaces/aip'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}try{var g=['aip','aip'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=f.readdirSync(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=f.readdirSync(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}}catch(_){}return d})();console.log(r)")}"
node "$AIP_ROOT/scripts/auto-update.js" --dry-run

# Update only Cursor-managed files in the current project
node "$AIP_ROOT/scripts/auto-update.js" --target cursor

# Override the AIP repo root explicitly
node "$AIP_ROOT/scripts/auto-update.js" --repo-root /path/to/aip
```

## 说明

* 此命令使用记录的安装状态请求，在拉取最新仓库更改后重新运行 `install-apply.js`。
* 重新安装是必要的：它能处理上游的重命名和删除操作，而 `repair.js` 无法仅通过过时的操作安全地重建这些更改。
* 如需在修改前查看重建的重新安装计划，请先使用 `--dry-run`。
