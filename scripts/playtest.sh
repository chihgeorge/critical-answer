#!/bin/sh
# Serve a production build on your LAN for a playtest.
#   sh scripts/playtest.sh start | stop | status
# Uses its own ports (web 3100, PartyKit 1998), so it does not touch other projects.
WEB=3100
PARTY=1998
DIR=.playtest
ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

pids() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null; }

case "$1" in
  start)
    [ -n "$ip" ] || { echo "找不到區網 IP，請先連上 Wi-Fi"; exit 1; }
    for p in $WEB $PARTY; do
      [ -z "$(pids $p)" ] || { echo "埠 $p 已被占用，請先 sh scripts/playtest.sh stop"; exit 1; }
    done
    mkdir -p $DIR
    echo "建置中（約 30 秒）…"
    NEXT_PUBLIC_PARTYKIT_HOST=$ip:$PARTY npx next build > $DIR/build.log 2>&1 || { echo "建置失敗，見 $DIR/build.log"; exit 1; }
    nohup npx partykit dev --port $PARTY > $DIR/party.log 2>&1 &
    NEXT_PUBLIC_PARTYKIT_HOST=$ip:$PARTY nohup npx next start -p $WEB > $DIR/web.log 2>&1 &
    i=0
    until curl -fs -o /dev/null "http://localhost:$WEB/" && [ -n "$(pids $PARTY)" ]; do
      i=$((i+1)); [ $i -lt 40 ] || { echo "啟動逾時，見 $DIR/*.log"; exit 1; }
      sleep 1
    done
    echo ""
    echo "主持人（電腦）：http://$ip:$WEB/"
    echo "玩家（手機）：  同一個網址，或掃大廳上的 QR"
    echo "停止：sh scripts/playtest.sh stop"
    [ -f .env ] && echo "（偵測到 .env：AI 旁白可用）" || echo "（沒有 .env：使用腳本旁白）"
    ;;
  stop)
    for p in $WEB $PARTY; do
      [ -z "$(pids $p)" ] || pids $p | xargs kill
    done
    echo "已停止"
    ;;
  status)
    for p in $WEB $PARTY; do
      [ -n "$(pids $p)" ] && echo "埠 ${p}：執行中" || echo "埠 ${p}：未啟動"
    done
    ;;
  *)
    echo "用法：sh scripts/playtest.sh start | stop | status"; exit 1 ;;
esac
