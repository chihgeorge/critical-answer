#!/bin/sh
# Serve a production build on your LAN for a playtest.
#   sh scripts/playtest.sh start | stop | status
# The room server is the same Worker that runs on Cloudflare, served by `wrangler dev`.
# Uses its own ports (web 3100, Worker 1998), so it does not touch other projects.
WEB=3100
WORKER=1998
DIR=.playtest
ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

pids() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null; }
# Stop a process and everything it started (npx -> node -> workerd), and only that.
killtree() {
  for child in $(pgrep -P "$1" 2>/dev/null); do killtree "$child"; done
  kill "$1" 2>/dev/null
}

case "$1" in
  start)
    [ -n "$ip" ] || { echo "找不到區網 IP，請先連上 Wi-Fi"; exit 1; }
    for p in $WEB $WORKER; do
      [ -z "$(pids $p)" ] || { echo "埠 $p 已被占用，請先 sh scripts/playtest.sh stop"; exit 1; }
    done
    mkdir -p $DIR
    rm -rf $DIR/state
    echo "建置中（約 30 秒）…"
    NEXT_PUBLIC_PARTYKIT_HOST=$ip:$WORKER npx next build > $DIR/build.log 2>&1 || { echo "建置失敗，見 $DIR/build.log"; exit 1; }
    # Phones on the LAN open the page from http://<ip>:3100, so any origin is fine here (never in production).
    nohup npx wrangler dev --port $WORKER --ip 0.0.0.0 --persist-to $DIR/state --var ALLOWED_ORIGINS:* > $DIR/worker.log 2>&1 &
    echo $! > $DIR/worker.pid
    NEXT_PUBLIC_PARTYKIT_HOST=$ip:$WORKER nohup npx next start -p $WEB > $DIR/web.log 2>&1 &
    echo $! > $DIR/web.pid
    i=0
    until curl -fs -o /dev/null "http://localhost:$WEB/" && curl -fs -o /dev/null "http://localhost:$WORKER/healthz"; do
      i=$((i+1)); [ $i -lt 60 ] || { echo "啟動逾時，見 $DIR/*.log"; exit 1; }
      sleep 1
    done
    echo ""
    echo "主持人（電腦）：http://$ip:$WEB/"
    echo "玩家（手機）：  同一個網址，或掃大廳上的 QR"
    echo "停止：sh scripts/playtest.sh stop"
    [ -f .env ] && echo "（偵測到 .env：AI 旁白可用）" || echo "（沒有 .env：使用腳本旁白）"
    ;;
  stop)
    for f in $DIR/worker.pid $DIR/web.pid; do
      [ -f "$f" ] && killtree "$(cat "$f")"
      rm -f "$f"
    done
    # Anything still holding our two ports (a start that was interrupted): wait, then force it.
    i=0
    while [ -n "$(pids $WEB)$(pids $WORKER)" ]; do
      i=$((i+1))
      [ $i -lt 6 ] || { for p in $WEB $WORKER; do pids $p | xargs kill -9 2>/dev/null; done; sleep 1; break; }
      for p in $WEB $WORKER; do pids $p | xargs kill 2>/dev/null; done
      sleep 1
    done
    echo "已停止"
    ;;
  status)
    for p in $WEB $WORKER; do
      [ -n "$(pids $p)" ] && echo "埠 ${p}：執行中" || echo "埠 ${p}：未啟動"
    done
    ;;
  *)
    echo "用法：sh scripts/playtest.sh start | stop | status"; exit 1 ;;
esac
